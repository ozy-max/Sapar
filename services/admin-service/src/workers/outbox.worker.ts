import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { OutboxEventRepository, OutboxEventRow } from '../adapters/db/outbox-event.repository';
import { loadEnv, getOutboxBackoffSchedule, parseOutboxTargets } from '../config/env';
import { EventEnvelope } from '../shared/event-envelope';
import { signPayload } from '../shared/hmac';
import { SERVICE_NAME } from '../observability/metrics.registry';
import {
  recordOutboxDelivery,
  recordOutboxDeliveryError,
  recordOutboxEvent,
} from '../observability/outbox-metrics';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepo: OutboxEventRepository,
  ) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      this.logger.log('Outbox worker disabled in test environment');
      return;
    }
    this.logger.log(`Starting outbox worker, poll interval: ${env.OUTBOX_WORKER_INTERVAL_MS}ms`);
    this.intervalHandle = setInterval(() => void this.tick(), env.OUTBOX_WORKER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const dueIds = await this.outboxRepo.findDueIds();
      for (const id of dueIds) {
        try {
          await this.processEvent(id);
        } catch (error) {
          this.logger.error(error, `Failed to process outbox event ${id}`);
        }
      }
    } catch (error) {
      this.logger.error(error, 'Outbox worker tick failed');
    } finally {
      this.running = false;
    }
  }

  private async processEvent(eventId: string): Promise<void> {
    const env = loadEnv();
    const backoff = getOutboxBackoffSchedule();
    const targets = parseOutboxTargets(env.OUTBOX_TARGETS);

    await this.prisma.$transaction(
      async (tx) => {
        const event = await this.outboxRepo.lockById(eventId, tx);
        if (!event) return;

        const targetUrl = targets.get(event.event_type);
        if (!targetUrl) {
          await this.outboxRepo.markSent(event.id, tx);
          recordOutboxEvent(event.event_type, 'sent');
          return;
        }

        const startMs = Date.now();
        const envelope = this.buildEnvelope(event);
        const body = JSON.stringify(envelope);
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = signPayload(body, timestamp, env.EVENTS_HMAC_SECRET);

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), env.OUTBOX_DELIVERY_TIMEOUT_MS);

          const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Event-Signature': signature,
              'X-Event-Timestamp': String(timestamp),
              'X-Request-Id': event.trace_id,
            },
            body,
            signal: controller.signal,
          });

          clearTimeout(timeout);
          const latencyMs = Date.now() - startMs;

          if (response.ok) {
            await this.outboxRepo.markSent(event.id, tx);
            recordOutboxEvent(event.event_type, 'sent');
            recordOutboxDelivery(targetUrl, latencyMs);
            this.logger.log({
              msg: 'Event delivered',
              eventId: event.id,
              eventType: event.event_type,
              target: targetUrl,
              attempt: event.try_count + 1,
              latencyMs,
              traceId: event.trace_id,
            });
          } else {
            const responseText = await response.text();
            throw new Error(`HTTP ${response.status}: ${responseText}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const nextTry = event.try_count + 1;
          recordOutboxDeliveryError(targetUrl);

          if (nextTry >= env.OUTBOX_RETRY_N) {
            await this.outboxRepo.markFailedFinal(event.id, nextTry, errorMsg, tx);
            recordOutboxEvent(event.event_type, 'failed_final');
            this.logger.error({
              msg: 'Event delivery failed permanently',
              eventId: event.id,
              eventType: event.event_type,
              attempt: nextTry,
              traceId: event.trace_id,
            });
          } else {
            const delaySec = backoff[nextTry - 1] ?? backoff[backoff.length - 1]!;
            const nextRetryAt = new Date(Date.now() + delaySec * 1000);
            await this.outboxRepo.markFailedRetry(event.id, nextTry, nextRetryAt, errorMsg, tx);
            recordOutboxEvent(event.event_type, 'failed_retry');
            this.logger.warn({
              msg: 'Event delivery failed, will retry',
              eventId: event.id,
              eventType: event.event_type,
              attempt: nextTry,
              nextRetryAt: nextRetryAt.toISOString(),
              traceId: event.trace_id,
            });
          }
        }
      },
      { timeout: env.OUTBOX_DELIVERY_TIMEOUT_MS + 5000 },
    );
  }

  private buildEnvelope(event: OutboxEventRow): EventEnvelope {
    return {
      eventId: event.id,
      eventType: event.event_type,
      occurredAt: event.occurred_at.toISOString(),
      producer: SERVICE_NAME,
      traceId: event.trace_id,
      payload: event.payload_json as Record<string, unknown>,
      version: 1,
    };
  }
}
