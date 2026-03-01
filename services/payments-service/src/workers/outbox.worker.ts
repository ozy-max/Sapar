import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { OutboxEventRepository, OutboxEventRow } from '../adapters/db/outbox-event.repository';
import { loadEnv, getOutboxBackoffSchedule, parseOutboxTargets } from '../config/env';
import { EventEnvelope } from '../shared/event-envelope';
import { signEvent } from '../shared/hmac';
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
  private currentTick?: Promise<void>;

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
    this.intervalHandle = setInterval(() => {
      this.currentTick = this.tick();
    }, env.OUTBOX_WORKER_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.currentTick) await this.currentTick;
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

    // Phase 1: Lock + read in short TX
    const event = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.outboxRepo.lockById(eventId, tx);
        if (!locked) return null;

        const targetUrl = targets.get(locked.event_type);
        if (!targetUrl) {
          await this.outboxRepo.markSent(locked.id, tx);
          recordOutboxEvent(locked.event_type, 'sent');
          return null;
        }

        return locked;
      },
      { timeout: 5000 },
    );

    if (!event) return;

    const targetUrl = targets.get(event.event_type)!;
    const startMs = Date.now();
    const envelope = this.buildEnvelope(event);
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signEvent(body, timestamp, env.EVENTS_HMAC_SECRET);

    // Phase 2: HTTP delivery OUTSIDE TX
    let deliverySuccess = false;
    let latencyMs = 0;
    let errorMsg = '';

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
      latencyMs = Date.now() - startMs;

      if (response.ok) {
        deliverySuccess = true;
      } else {
        const responseText = await response.text();
        errorMsg = `HTTP ${response.status}: ${responseText}`;
      }
    } catch (err) {
      latencyMs = Date.now() - startMs;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    // Phase 3: Update status in new short TX
    await this.prisma.$transaction(
      async (tx) => {
        const current = await this.outboxRepo.lockById(eventId, tx);
        if (!current) return;

        if (deliverySuccess) {
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
              error: errorMsg,
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
      { timeout: 5000 },
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
