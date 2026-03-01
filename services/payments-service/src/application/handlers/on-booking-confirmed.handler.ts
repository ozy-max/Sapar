import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../../adapters/psp/psp.interface';
import { withTimeout } from '../../shared/psp-timeout';
import { loadEnv } from '../../config/env';
import { recordSagaOutcome } from '../../observability/saga-metrics';

interface PaymentIntentRow {
  id: string;
  booking_id: string;
  payer_id: string;
  amount_kgs: number;
  currency: string;
  status: string;
  psp_intent_id: string | null;
}

interface BookingConfirmedPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
}

@Injectable()
export class OnBookingConfirmedHandler implements EventHandler {
  readonly eventType = 'booking.confirmed';
  private readonly logger = new Logger(OnBookingConfirmedHandler.name);

  constructor(
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as BookingConfirmedPayload;

    const intents = await tx.$queryRaw<PaymentIntentRow[]>`
      SELECT id, booking_id, payer_id, amount_kgs, currency, status, psp_intent_id
      FROM payment_intents
      WHERE booking_id = ${p.bookingId}::uuid
      FOR UPDATE
    `;
    const row = intents[0];

    if (!row) {
      this.logger.warn({ msg: 'No payment intent found for confirmed booking', bookingId: p.bookingId, traceId: event.traceId });
      return;
    }

    if (row.status === 'CAPTURED') {
      this.logger.log({ msg: 'Already captured (idempotent)', bookingId: p.bookingId, traceId: event.traceId });
      recordSagaOutcome('payments', 'capture', 'success');
      return;
    }

    if (row.status !== 'HOLD_PLACED') {
      this.logger.log({
        msg: 'Cannot capture: intent not in HOLD_PLACED state',
        bookingId: p.bookingId,
        currentStatus: row.status,
        traceId: event.traceId,
      });
      return;
    }

    const env = loadEnv();
    try {
      await withTimeout(this.psp.capture(row.psp_intent_id!), env.PSP_TIMEOUT_MS);
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

    await tx.paymentIntent.update({
      where: { id: row.id },
      data: { status: 'CAPTURED' },
    });

    await tx.paymentEvent.create({
      data: {
        paymentIntentId: row.id,
        type: 'CAPTURED',
        payloadJson: { triggeredBy: event.eventType },
      },
    });

    await tx.receipt.create({
      data: {
        paymentIntentId: row.id,
        status: 'PENDING',
        nextRetryAt: new Date(),
      },
    });

    await this.outboxService.publish(
      {
        eventType: 'payment.captured',
        payload: {
          paymentIntentId: row.id,
          bookingId: p.bookingId,
          passengerId: p.passengerId,
          amountKgs: row.amount_kgs,
        },
        traceId: event.traceId,
      },
      tx,
    );

    recordSagaOutcome('payments', 'capture', 'success');

    this.logger.log({
      msg: 'Payment captured for confirmed booking',
      bookingId: p.bookingId,
      paymentIntentId: row.id,
      traceId: event.traceId,
    });
  }
}
