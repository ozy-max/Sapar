import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';
import { BookingRow } from '../../adapters/db/booking.repository';
import { recordBookingTransition, recordSagaOutcome } from '../../observability/saga-metrics';

interface PaymentHoldPlacedPayload {
  paymentIntentId: string;
  bookingId: string;
  passengerId: string;
  amountKgs: number;
  pspIntentId?: string;
  status: string;
  occurredAt: string;
}

@Injectable()
export class OnPaymentHoldPlacedHandler implements EventHandler {
  readonly eventType = 'payment.intent.hold_placed';
  private readonly logger = new Logger(OnPaymentHoldPlacedHandler.name);

  constructor(private readonly outboxService: OutboxService) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as PaymentHoldPlacedPayload;

    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT id, trip_id, passenger_id, seats, status, created_at, updated_at
      FROM bookings
      WHERE id = ${p.bookingId}::uuid
      FOR UPDATE
    `;
    const booking = rows[0];

    if (!booking) {
      this.logger.warn({
        msg: 'Booking not found for hold_placed',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    if (booking.status === 'CONFIRMED') {
      this.logger.log({
        msg: 'Booking already CONFIRMED (idempotent)',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      recordSagaOutcome('trips', 'confirm', 'success');
      return;
    }

    if (booking.status !== 'PENDING_PAYMENT') {
      this.logger.log({
        msg: 'Cannot transition to CONFIRMED from current status',
        bookingId: p.bookingId,
        currentStatus: booking.status,
        traceId: event.traceId,
      });
      recordBookingTransition(booking.status, 'CONFIRMED');
      return;
    }

    await tx.booking.update({
      where: { id: p.bookingId },
      data: { status: 'CONFIRMED' },
    });

    await this.outboxService.publish(
      {
        eventType: 'booking.confirmed',
        payload: {
          bookingId: p.bookingId,
          tripId: booking.trip_id,
          passengerId: booking.passenger_id,
        },
        traceId: event.traceId,
      },
      tx,
    );

    recordBookingTransition('PENDING_PAYMENT', 'CONFIRMED');
    recordSagaOutcome('trips', 'confirm', 'success');

    this.logger.log({
      msg: 'Booking confirmed after payment hold',
      bookingId: p.bookingId,
      traceId: event.traceId,
    });
  }
}
