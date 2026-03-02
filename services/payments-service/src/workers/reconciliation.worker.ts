import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { OutboxService } from '../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../adapters/psp/psp.interface';
import { loadEnv } from '../config/env';
import { withTimeout } from '../shared/psp-timeout';
import { PaymentEventType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const PSP_STATUS_MAP: Record<string, PaymentEventType> = {
  hold_placed: 'HOLD_PLACED',
  captured: 'CAPTURED',
  failed: 'FAILED',
  refunded: 'REFUNDED',
  cancelled: 'CANCELLED',
};

const OUTBOX_EVENT_MAP: Partial<Record<PaymentEventType, string>> = {
  CAPTURED: 'payment.captured',
  REFUNDED: 'payment.refunded',
  CANCELLED: 'payment.cancelled',
  FAILED: 'payment.failed',
  HOLD_PLACED: 'payment.intent.hold_placed',
};

@Injectable()
export class ReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationWorker.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private running = false;
  private currentTick?: Promise<void>;

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

    this.logger.log(`Starting ReconciliationWorker, interval: ${env.RECONCILIATION_INTERVAL_MS}ms`);
    this.intervalHandle = setInterval(() => {
      this.currentTick = this.doTick();
    }, env.RECONCILIATION_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.currentTick) await this.currentTick;
  }

  private async doTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const env = loadEnv();
      const stuck = await this.intentRepo.findStuckIntents(
        env.RECONCILIATION_STALE_MINUTES,
        env.RECONCILIATION_BATCH_SIZE,
      );
      for (const intent of stuck) {
        await this.reconcileOne(intent);
      }
      if (stuck.length > 0) {
        this.logger.log(`Reconciled ${stuck.length} intent(s)`);
      }
    } catch (error) {
      this.logger.error(error, 'ReconciliationWorker tick failed');
    } finally {
      this.running = false;
    }
  }

  private async reconcileOne(intent: {
    id: string;
    status: string;
    psp_intent_id: string | null;
  }): Promise<void> {
    const traceId = randomUUID();

    if (!intent.psp_intent_id) {
      if (intent.status === 'CREATED' || intent.status === 'HOLD_REQUESTED') {
        await this.prisma.$transaction(async (tx) => {
          const locked = await this.intentRepo.findByIdForUpdate(intent.id, tx);
          if (!locked || locked.status !== intent.status) return;

          await this.intentRepo.updateStatus(intent.id, 'FAILED', tx);
          await this.eventRepo.create(
            {
              paymentIntentId: intent.id,
              type: 'FAILED',
              payloadJson: { reason: 'reconciliation_no_psp_id' },
            },
            tx,
          );
          await this.outboxService.publish(
            {
              eventType: 'payment.failed',
              payload: {
                paymentIntentId: intent.id,
                bookingId: locked.booking_id,
                reason: 'reconciliation_no_psp_id',
              },
              traceId,
            },
            tx,
          );
        });
        this.logger.warn({
          msg: `Reconciled ${intent.status} intent without psp_intent_id → FAILED`,
          intentId: intent.id,
        });
      }
      return;
    }

    const env = loadEnv();
    try {
      const pspResult = await withTimeout(
        this.psp.getStatus(intent.psp_intent_id),
        env.PSP_TIMEOUT_MS,
      );
      const mappedStatus = PSP_STATUS_MAP[pspResult.status];
      if (!mappedStatus || mappedStatus === intent.status) return;

      await this.prisma.$transaction(async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intent.id, tx);
        if (!locked || locked.status !== intent.status) return;

        await this.intentRepo.updateStatus(intent.id, mappedStatus, tx);
        await this.eventRepo.create(
          {
            paymentIntentId: intent.id,
            type: mappedStatus,
            payloadJson: { reason: 'reconciliation', pspStatus: pspResult.status },
          },
          tx,
        );

        const outboxEventType = OUTBOX_EVENT_MAP[mappedStatus];
        if (outboxEventType) {
          await this.outboxService.publish(
            {
              eventType: outboxEventType,
              payload: {
                paymentIntentId: intent.id,
                bookingId: locked.booking_id,
                amountKgs: locked.amount_kgs,
                reconciliation: true,
              },
              traceId,
            },
            tx,
          );
        }
      });
      this.logger.log({
        msg: 'Reconciled intent',
        intentId: intent.id,
        from: intent.status,
        to: mappedStatus,
      });
    } catch (error) {
      this.logger.warn({
        msg: 'Reconciliation PSP check failed',
        intentId: intent.id,
        error: String(error),
      });
    }
  }
}
