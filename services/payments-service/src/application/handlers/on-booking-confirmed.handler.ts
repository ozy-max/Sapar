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
import { recordSagaOutcome } from '../../observability/saga-metrics';
import { DataCorruptionError } from '../../shared/errors';

const bookingConfirmedPayloadSchema = z.object({
  bookingId: z.string().uuid(),
  tripId: z.string().uuid(),
  passengerId: z.string().uuid(),
});

@Injectable()
export class OnBookingConfirmedHandler implements SideEffectHandler {
  readonly eventType = 'booking.confirmed';
  readonly hasSideEffects = true as const;
  private readonly logger = new Logger(OnBookingConfirmedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope): Promise<void> {
    const parsed = bookingConfirmedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({
        msg: 'Invalid booking.confirmed payload',
        errors: parsed.error.flatten().fieldErrors,
        eventId: event.eventId,
        traceId: event.traceId,
      });
      return;
    }
    const p = parsed.data;

    const intent = await this.intentRepo.findByBookingId(p.bookingId);
    if (!intent) {
      this.logger.warn({
        msg: 'No payment intent found for confirmed booking',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    if (intent.status === 'CAPTURED') {
      this.logger.log({
        msg: 'Already captured (idempotent)',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      recordSagaOutcome('payments', 'capture', 'success');
      return;
    }

    if (intent.status !== 'HOLD_PLACED') {
      this.logger.log({
        msg: 'Cannot capture: intent not in HOLD_PLACED state',
        bookingId: p.bookingId,
        currentStatus: intent.status,
        traceId: event.traceId,
      });
      return;
    }

    if (!intent.pspIntentId) {
      throw new DataCorruptionError(`Payment intent ${intent.id} missing psp_intent_id`);
    }

    // --- PSP call OUTSIDE any DB transaction ---
    const env = loadEnv();
    try {
      await withTimeout(this.psp.capture(intent.pspIntentId), env.PSP_TIMEOUT_MS);
    } catch (error) {
      this.logger.error({
        msg: 'PSP capture failed, will retry via event re-delivery',
        bookingId: p.bookingId,
        error: error instanceof Error ? error.message : String(error),
        traceId: event.traceId,
      });
      recordSagaOutcome('payments', 'capture', 'fail');
      throw error;
    }

    // --- Finalize in a short TX: lock, validate, update, publish outbox ---
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intent.id, tx);
        if (!locked || locked.status !== 'HOLD_PLACED') {
          this.logger.warn({
            msg: 'State changed between PSP call and finalization, skipping DB update',
            intentId: intent.id,
            currentStatus: locked?.status,
            traceId: event.traceId,
          });
          return;
        }

        await this.intentRepo.updateStatus(intent.id, 'CAPTURED', tx);

        await this.eventRepo.create(
          {
            paymentIntentId: intent.id,
            type: 'CAPTURED',
            payloadJson: { triggeredBy: event.eventType },
          },
          tx,
        );

        await tx.receipt.create({
          data: {
            paymentIntentId: intent.id,
            status: 'PENDING',
            nextRetryAt: new Date(),
          },
        });

        await this.outboxService.publish(
          {
            eventType: 'payment.captured',
            payload: {
              paymentIntentId: intent.id,
              bookingId: p.bookingId,
              passengerId: p.passengerId,
              amountKgs: intent.amountKgs,
            },
            traceId: event.traceId,
          },
          tx,
        );
      },
      { timeout: 10_000 },
    );

    recordSagaOutcome('payments', 'capture', 'success');
    this.logger.log({
      msg: 'Payment captured for confirmed booking',
      bookingId: p.bookingId,
      paymentIntentId: intent.id,
      traceId: event.traceId,
    });
  }
}
