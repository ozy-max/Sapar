import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../../adapters/psp/psp.interface';
import { withTimeout } from '../../shared/psp-timeout';
import { loadEnv } from '../../config/env';
import { recordPaymentCompensation, recordSagaOutcome } from '../../observability/saga-metrics';
import { DataCorruptionError } from '../../shared/errors';

interface PaymentIntentRow {
  id: string;
  booking_id: string;
  payer_id: string;
  amount_kgs: number;
  currency: string;
  status: string;
  psp_intent_id: string | null;
}

const bookingCancelledPayloadSchema = z.object({
  bookingId: z.string().uuid(),
  tripId: z.string().uuid(),
  passengerId: z.string().uuid(),
  seats: z.number().int().positive(),
  reason: z.string().min(1),
});

@Injectable()
export class OnBookingCancelledHandler implements EventHandler {
  readonly eventType = 'booking.cancelled';
  private readonly logger = new Logger(OnBookingCancelledHandler.name);

  constructor(
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
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

    const intents = await tx.$queryRaw<PaymentIntentRow[]>`
      SELECT id, booking_id, payer_id, amount_kgs, currency, status, psp_intent_id
      FROM payment_intents
      WHERE booking_id = ${p.bookingId}::uuid
      FOR UPDATE
    `;
    const row = intents[0];

    if (!row) {
      this.logger.log({
        msg: 'No payment intent for cancelled/expired booking',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    const terminalStatuses = ['CANCELLED', 'REFUNDED', 'FAILED'];
    if (terminalStatuses.includes(row.status)) {
      this.logger.log({
        msg: 'Payment already in terminal state',
        bookingId: p.bookingId,
        status: row.status,
        traceId: event.traceId,
      });
      return;
    }

    const env = loadEnv();

    if (row.status === 'HOLD_PLACED') {
      if (row.psp_intent_id) {
        try {
          await withTimeout(this.psp.cancelHold(row.psp_intent_id), env.PSP_TIMEOUT_MS);
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

      await tx.paymentIntent.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
      await tx.paymentEvent.create({
        data: {
          paymentIntentId: row.id,
          type: 'CANCELLED',
          payloadJson: { reason: p.reason, triggeredBy: event.eventType },
        },
      });
      await this.outboxService.publish(
        {
          eventType: 'payment.cancelled',
          payload: { paymentIntentId: row.id, bookingId: p.bookingId },
          traceId: event.traceId,
        },
        tx,
      );
      recordPaymentCompensation('cancel_hold');
      recordSagaOutcome('payments', 'cancel_hold', 'success');
    } else if (row.status === 'CAPTURED') {
      if (!row.psp_intent_id) {
        throw new DataCorruptionError(`Payment intent ${row.id} missing psp_intent_id`);
      }

      const pspStatus = await withTimeout(
        this.psp.getStatus(row.psp_intent_id),
        env.PSP_TIMEOUT_MS,
      );
      if (pspStatus.status === 'refunded') {
        this.logger.warn({
          msg: 'PSP already refunded, syncing local state',
          paymentIntentId: row.id,
          traceId: event.traceId,
        });
      } else {
        try {
          await withTimeout(this.psp.refund(row.psp_intent_id, row.amount_kgs), env.PSP_TIMEOUT_MS);
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

      await tx.paymentIntent.update({ where: { id: row.id }, data: { status: 'REFUNDED' } });
      await tx.paymentEvent.create({
        data: {
          paymentIntentId: row.id,
          type: 'REFUNDED',
          payloadJson: { reason: p.reason, triggeredBy: event.eventType },
        },
      });
      await this.outboxService.publish(
        {
          eventType: 'payment.refunded',
          payload: { paymentIntentId: row.id, bookingId: p.bookingId, amountKgs: row.amount_kgs },
          traceId: event.traceId,
        },
        tx,
      );
      recordPaymentCompensation('refund');
      recordSagaOutcome('payments', 'refund', 'success');
    } else if (row.status === 'CREATED') {
      await tx.paymentIntent.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
      await tx.paymentEvent.create({
        data: {
          paymentIntentId: row.id,
          type: 'CANCELLED',
          payloadJson: { reason: p.reason, triggeredBy: event.eventType },
        },
      });
      await this.outboxService.publish(
        {
          eventType: 'payment.cancelled',
          payload: { paymentIntentId: row.id, bookingId: p.bookingId },
          traceId: event.traceId,
        },
        tx,
      );
      recordPaymentCompensation('cancel_hold');
    }

    this.logger.log({
      msg: 'Payment compensated for cancelled/expired booking',
      bookingId: p.bookingId,
      previousStatus: row.status,
      traceId: event.traceId,
    });
  }
}
