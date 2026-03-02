import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { SideEffectHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { PrismaService } from '../../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../../adapters/db/payment-event.repository';
import { OutboxService } from '../../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../../adapters/psp/psp.interface';
import { withTimeout } from '../../shared/psp-timeout';
import { loadEnv } from '../../config/env';
import { recordPaymentCompensation, recordSagaOutcome } from '../../observability/saga-metrics';
import { DataCorruptionError } from '../../shared/errors';

const bookingCancelledPayloadSchema = z.object({
  bookingId: z.string().uuid(),
  tripId: z.string().uuid(),
  passengerId: z.string().uuid(),
  seats: z.number().int().positive(),
  reason: z.string().min(1),
});

@Injectable()
export class OnBookingCancelledHandler implements SideEffectHandler {
  readonly eventType = 'booking.cancelled';
  readonly hasSideEffects = true as const;
  private readonly logger = new Logger(OnBookingCancelledHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope): Promise<void> {
    const parsed = bookingCancelledPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({
        msg: 'Invalid booking.cancelled payload',
        errors: parsed.error.flatten().fieldErrors,
        eventId: event.eventId,
        traceId: event.traceId,
      });
      return;
    }
    const p = parsed.data;

    const intent = await this.intentRepo.findByBookingId(p.bookingId);
    if (!intent) {
      this.logger.log({
        msg: 'No payment intent for cancelled/expired booking',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    const terminalStatuses = ['CANCELLED', 'REFUNDED', 'FAILED'];
    if (terminalStatuses.includes(intent.status)) {
      this.logger.log({
        msg: 'Payment already in terminal state',
        bookingId: p.bookingId,
        status: intent.status,
        traceId: event.traceId,
      });
      return;
    }

    if (intent.status === 'CREATED' || intent.status === 'HOLD_REQUESTED') {
      await this.cancelWithoutPsp(intent.id, p, event);
      return;
    }

    if (intent.status === 'HOLD_PLACED') {
      await this.cancelHoldAtPsp(intent, p, event);
      return;
    }

    if (intent.status === 'CAPTURED') {
      await this.refundAtPsp(intent, p, event);
      return;
    }

    this.logger.warn({
      msg: 'Unexpected intent status for booking cancellation',
      bookingId: p.bookingId,
      status: intent.status,
      traceId: event.traceId,
    });
  }

  private async cancelWithoutPsp(
    intentId: string,
    p: { bookingId: string; reason: string },
    event: EventEnvelope,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!locked) return;

        if (['CANCELLED', 'REFUNDED', 'FAILED'].includes(locked.status)) return;

        if (locked.status === 'HOLD_PLACED') {
          // State escalated while we were about to cancel without PSP.
          // Throw to trigger re-delivery; next attempt will pick the correct branch.
          throw new Error('Intent escalated to HOLD_PLACED, retry needed');
        }

        await this.intentRepo.updateStatus(intentId, 'CANCELLED', tx);
        await this.createEventAndPublish(intentId, 'CANCELLED', 'payment.cancelled', p, event, tx);
      },
      { timeout: 10_000 },
    );
    recordPaymentCompensation('cancel_hold');
    this.logDone(p.bookingId, 'CREATED/HOLD_REQUESTED', event.traceId);
  }

  private async cancelHoldAtPsp(
    intent: { id: string; pspIntentId: string | null; amountKgs: number },
    p: { bookingId: string; reason: string },
    event: EventEnvelope,
  ): Promise<void> {
    if (intent.pspIntentId) {
      const env = loadEnv();
      try {
        await withTimeout(this.psp.cancelHold(intent.pspIntentId), env.PSP_TIMEOUT_MS);
      } catch (error) {
        this.logger.error({
          msg: 'PSP cancelHold failed, will retry',
          bookingId: p.bookingId,
          error: String(error),
          traceId: event.traceId,
        });
        throw error;
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intent.id, tx);
        if (!locked || ['CANCELLED', 'REFUNDED', 'FAILED'].includes(locked.status)) return;

        if (locked.status !== 'HOLD_PLACED') {
          this.logger.warn({
            msg: 'State changed between PSP cancelHold and finalization',
            intentId: intent.id,
            currentStatus: locked.status,
            traceId: event.traceId,
          });
          return;
        }

        await this.intentRepo.updateStatus(intent.id, 'CANCELLED', tx);
        await this.createEventAndPublish(intent.id, 'CANCELLED', 'payment.cancelled', p, event, tx);
      },
      { timeout: 10_000 },
    );
    recordPaymentCompensation('cancel_hold');
    recordSagaOutcome('payments', 'cancel_hold', 'success');
    this.logDone(p.bookingId, 'HOLD_PLACED', event.traceId);
  }

  private async refundAtPsp(
    intent: { id: string; pspIntentId: string | null; amountKgs: number },
    p: { bookingId: string; reason: string },
    event: EventEnvelope,
  ): Promise<void> {
    if (!intent.pspIntentId) {
      throw new DataCorruptionError(`Payment intent ${intent.id} missing psp_intent_id`);
    }

    const env = loadEnv();
    const pspStatus = await withTimeout(this.psp.getStatus(intent.pspIntentId), env.PSP_TIMEOUT_MS);

    if (pspStatus.status === 'refunded') {
      this.logger.warn({
        msg: 'PSP already refunded, syncing local state',
        paymentIntentId: intent.id,
        traceId: event.traceId,
      });
    } else {
      try {
        await withTimeout(
          this.psp.refund(intent.pspIntentId, intent.amountKgs),
          env.PSP_TIMEOUT_MS,
        );
      } catch (error) {
        this.logger.error({
          msg: 'PSP refund failed, will retry',
          bookingId: p.bookingId,
          error: String(error),
          traceId: event.traceId,
        });
        throw error;
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intent.id, tx);
        if (!locked || ['REFUNDED', 'FAILED'].includes(locked.status)) return;

        if (locked.status !== 'CAPTURED') {
          this.logger.warn({
            msg: 'State changed between PSP refund and finalization',
            intentId: intent.id,
            currentStatus: locked.status,
            traceId: event.traceId,
          });
          return;
        }

        await this.intentRepo.updateStatus(intent.id, 'REFUNDED', tx);
        await this.createEventAndPublish(
          intent.id,
          'REFUNDED',
          'payment.refunded',
          { ...p, amountKgs: intent.amountKgs },
          event,
          tx,
        );
      },
      { timeout: 10_000 },
    );
    recordPaymentCompensation('refund');
    recordSagaOutcome('payments', 'refund', 'success');
    this.logDone(p.bookingId, 'CAPTURED', event.traceId);
  }

  private async createEventAndPublish(
    intentId: string,
    eventType: 'CANCELLED' | 'REFUNDED',
    outboxEventType: string,
    p: { bookingId: string; reason: string; amountKgs?: number },
    event: EventEnvelope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.eventRepo.create(
      {
        paymentIntentId: intentId,
        type: eventType,
        payloadJson: { reason: p.reason, triggeredBy: event.eventType },
      },
      tx,
    );

    const outboxPayload: Record<string, unknown> = {
      paymentIntentId: intentId,
      bookingId: p.bookingId,
    };
    if (p.amountKgs !== undefined) outboxPayload['amountKgs'] = p.amountKgs;

    await this.outboxService.publish(
      { eventType: outboxEventType, payload: outboxPayload, traceId: event.traceId },
      tx,
    );
  }

  private logDone(bookingId: string, previousStatus: string, traceId: string): void {
    this.logger.log({
      msg: 'Payment compensated for cancelled/expired booking',
      bookingId,
      previousStatus,
      traceId,
    });
  }
}
