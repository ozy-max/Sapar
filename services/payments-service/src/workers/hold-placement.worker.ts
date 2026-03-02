import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { OutboxService } from '../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../adapters/psp/psp.interface';
import { withTimeout } from '../shared/psp-timeout';
import { loadEnv } from '../config/env';
import { recordSagaOutcome } from '../observability/saga-metrics';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

interface HoldRequestedRow {
  id: string;
  booking_id: string;
  payer_id: string;
  amount_kgs: number;
  currency: string;
  created_at: Date;
}

@Injectable()
export class HoldPlacementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldPlacementWorker.name);
  private timeoutHandle?: ReturnType<typeof setTimeout>;
  private running = false;
  private currentTick?: Promise<void>;
  private consecutiveFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') return;

    const intervalMs = env.HOLD_PLACEMENT_INTERVAL_MS ?? 1000;
    this.logger.log(`Starting HoldPlacementWorker, interval: ${intervalMs}ms`);
    this.scheduleTick(intervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    if (this.currentTick) await this.currentTick;
  }

  private scheduleTick(delayMs: number): void {
    this.timeoutHandle = setTimeout(() => {
      this.currentTick = this.doTick();
    }, delayMs);
  }

  private getBackoffDelay(): number {
    if (this.consecutiveFailures === 0) return loadEnv().HOLD_PLACEMENT_INTERVAL_MS ?? 1000;
    const exponential = BASE_BACKOFF_MS * Math.pow(2, Math.min(this.consecutiveFailures - 1, 14));
    const capped = Math.min(exponential, MAX_BACKOFF_MS);
    const jitter = capped * (0.5 + Math.random() * 0.5);
    return Math.floor(jitter);
  }

  async doTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.$queryRaw<HoldRequestedRow[]>`
        SELECT id, booking_id, payer_id, amount_kgs, currency, created_at
        FROM payment_intents
        WHERE status = 'HOLD_REQUESTED'
        ORDER BY created_at ASC
        LIMIT 10
      `;

      for (const row of rows) {
        await this.processOne(row);
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures++;
      this.logger.error(error, `HoldPlacementWorker tick failed (consecutive: ${this.consecutiveFailures})`);
    } finally {
      this.running = false;
      this.scheduleTick(this.getBackoffDelay());
    }
  }

  private async processOne(row: HoldRequestedRow): Promise<void> {
    const env = loadEnv();
    let pspIntentId: string | undefined;
    let holdFailed = false;
    let failReason = '';

    try {
      const result = await withTimeout(
        this.psp.placeHold(row.amount_kgs, row.currency, { bookingId: row.booking_id }),
        env.PSP_TIMEOUT_MS,
      );
      pspIntentId = result.pspIntentId;
    } catch (error) {
      holdFailed = true;
      failReason = error instanceof Error ? error.message : String(error);
      this.logger.error({
        msg: 'PSP placeHold failed',
        intentId: row.id,
        bookingId: row.booking_id,
        error: failReason,
      });
    }

    if (holdFailed) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(row.id, tx);
        if (!locked || locked.status !== 'HOLD_REQUESTED') return;

        await this.intentRepo.updateStatus(row.id, 'FAILED', tx);
        await this.eventRepo.create(
          {
            paymentIntentId: row.id,
            type: 'FAILED',
            payloadJson: { reason: failReason, triggeredBy: 'hold_placement_worker' },
          },
          tx,
        );
        await this.outboxService.publish(
          {
            eventType: 'payment.intent.failed',
            payload: {
              paymentIntentId: row.id,
              bookingId: row.booking_id,
              passengerId: row.payer_id,
              reason: failReason,
            },
            traceId: `hold-worker-${row.id}`,
          },
          tx,
        );
      });
      recordSagaOutcome('payments', 'hold', 'fail');
    } else {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(row.id, tx);
        if (!locked || locked.status !== 'HOLD_REQUESTED') return;

        await this.intentRepo.updateStatus(row.id, 'HOLD_PLACED', tx, { pspIntentId });
        await this.eventRepo.create(
          {
            paymentIntentId: row.id,
            type: 'HOLD_PLACED',
            payloadJson: { pspIntentId, triggeredBy: 'hold_placement_worker', bookingId: row.booking_id },
          },
          tx,
        );
        await this.outboxService.publish(
          {
            eventType: 'payment.intent.hold_placed',
            payload: {
              paymentIntentId: row.id,
              bookingId: row.booking_id,
              passengerId: row.payer_id,
              amountKgs: row.amount_kgs,
              pspIntentId,
              status: 'HOLD_PLACED',
              occurredAt: new Date().toISOString(),
            },
            traceId: `hold-worker-${row.id}`,
          },
          tx,
        );
      });
      recordSagaOutcome('payments', 'hold', 'success');
      this.logger.log({
        msg: 'Hold placed successfully',
        intentId: row.id,
        bookingId: row.booking_id,
        pspIntentId,
      });
    }
  }
}
