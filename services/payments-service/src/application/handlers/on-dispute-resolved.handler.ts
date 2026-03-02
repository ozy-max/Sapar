import { Injectable, Inject, Logger } from '@nestjs/common';
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
import { DataCorruptionError } from '../../shared/errors';

const disputeResolvedPayloadSchema = z.object({
  disputeId: z.string().min(1),
  bookingId: z.string().uuid(),
  resolution: z.enum(['REFUND', 'PARTIAL', 'NO_REFUND']),
  refundAmountKgs: z.number().int().positive().optional(),
});

@Injectable()
export class OnDisputeResolvedHandler implements SideEffectHandler {
  readonly eventType = 'dispute.resolved';
  readonly hasSideEffects = true as const;
  private readonly logger = new Logger(OnDisputeResolvedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope): Promise<void> {
    const parsed = disputeResolvedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({
        msg: 'Invalid dispute.resolved payload',
        errors: parsed.error.flatten().fieldErrors,
        eventId: event.eventId,
        traceId: event.traceId,
      });
      return;
    }
    const p = parsed.data;

    if (p.resolution === 'NO_REFUND') {
      this.logger.log({
        msg: 'Dispute resolved with NO_REFUND, skipping',
        disputeId: p.disputeId,
        traceId: event.traceId,
      });
      return;
    }

    const intent = await this.intentRepo.findByBookingId(p.bookingId);
    if (!intent) {
      this.logger.log({
        msg: 'No payment intent for dispute',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    if (intent.status === 'REFUNDED') {
      this.logger.log({
        msg: 'Payment already refunded',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    if (intent.status !== 'CAPTURED') {
      this.logger.warn({
        msg: 'Cannot refund: payment not captured',
        bookingId: p.bookingId,
        status: intent.status,
        traceId: event.traceId,
      });
      return;
    }

    const refundAmount =
      p.resolution === 'PARTIAL' && p.refundAmountKgs ? p.refundAmountKgs : intent.amountKgs;

    if (refundAmount <= 0 || refundAmount > intent.amountKgs) {
      this.logger.warn({
        msg: 'Invalid refund amount',
        refundAmount,
        originalAmount: intent.amountKgs,
        traceId: event.traceId,
      });
      throw new DataCorruptionError(
        `Invalid refund amount: ${refundAmount} exceeds original ${intent.amountKgs}`,
      );
    }

    if (!intent.pspIntentId) {
      throw new DataCorruptionError(`Payment intent ${intent.id} missing psp_intent_id`);
    }

    // --- PSP calls OUTSIDE any DB transaction ---
    const env = loadEnv();

    const pspStatus = await withTimeout(this.psp.getStatus(intent.pspIntentId), env.PSP_TIMEOUT_MS);
    if (pspStatus.status === 'refunded') {
      this.logger.warn({
        msg: 'PSP already refunded (dispute), syncing local state',
        paymentIntentId: intent.id,
        traceId: event.traceId,
      });
    } else {
      try {
        await withTimeout(this.psp.refund(intent.pspIntentId, refundAmount), env.PSP_TIMEOUT_MS);
      } catch (error) {
        this.logger.error({
          msg: 'PSP refund failed for dispute',
          disputeId: p.disputeId,
          error: String(error),
          traceId: event.traceId,
        });
        throw error;
      }
    }

    // --- Finalize in a short TX: lock, validate, update, publish outbox ---
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intent.id, tx);
        if (!locked || locked.status === 'REFUNDED') return;

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

        await this.eventRepo.create(
          {
            paymentIntentId: intent.id,
            type: 'REFUNDED',
            payloadJson: {
              reason: 'dispute_resolved',
              disputeId: p.disputeId,
              resolution: p.resolution,
              refundAmountKgs: refundAmount,
              triggeredBy: event.eventType,
            },
          },
          tx,
        );

        await this.outboxService.publish(
          {
            eventType: 'payment.refunded',
            payload: {
              paymentIntentId: intent.id,
              bookingId: p.bookingId,
              amountKgs: refundAmount,
              disputeId: p.disputeId,
            },
            traceId: event.traceId,
          },
          tx,
        );
      },
      { timeout: 10_000 },
    );

    this.logger.log({
      msg: 'Payment refunded for dispute',
      disputeId: p.disputeId,
      bookingId: p.bookingId,
      resolution: p.resolution,
      refundAmountKgs: refundAmount,
      traceId: event.traceId,
    });
  }
}
