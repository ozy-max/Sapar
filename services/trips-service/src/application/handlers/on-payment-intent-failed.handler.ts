import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';
import { BookingRow } from '../../adapters/db/booking.repository';
import { recordBookingTransition, recordSagaOutcome } from '../../observability/saga-metrics';

interface PaymentIntentFailedPayload {
  paymentIntentId: string;
  bookingId: string;
  passengerId: string;
  reason: string;
}

@Injectable()
export class OnPaymentIntentFailedHandler implements EventHandler {
  readonly eventType = 'payment.intent.failed';
  private readonly logger = new Logger(OnPaymentIntentFailedHandler.name);

  constructor(private readonly outboxService: OutboxService) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as PaymentIntentFailedPayload;

    await tx.$queryRaw`
      SELECT id FROM trips
      WHERE id = (SELECT trip_id FROM bookings WHERE id = ${p.bookingId}::uuid)
      FOR UPDATE
    `;

    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT id, trip_id, passenger_id, seats, status, created_at, updated_at
      FROM bookings
      WHERE id = ${p.bookingId}::uuid
      FOR UPDATE
    `;
    const booking = rows[0];

    if (!booking) {
      this.logger.warn({
        msg: 'Booking not found for intent_failed',
        bookingId: p.bookingId,
        traceId: event.traceId,
      });
      return;
    }

    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
      this.logger.log({
        msg: 'Booking already terminal',
        bookingId: p.bookingId,
        status: booking.status,
        traceId: event.traceId,
      });
      return;
    }

    if (booking.status !== 'PENDING_PAYMENT') {
      this.logger.log({
        msg: 'Cannot cancel from current status on payment failure',
        bookingId: p.bookingId,
        currentStatus: booking.status,
        traceId: event.traceId,
      });
      return;
    }

    await tx.booking.update({
      where: { id: p.bookingId },
      data: { status: 'CANCELLED' },
    });

    await tx.$executeRaw`
      UPDATE trips SET seats_available = seats_available + ${booking.seats}
      WHERE id = ${booking.trip_id}::uuid
    `;

    await this.outboxService.publish(
      {
        eventType: 'booking.cancelled',
        payload: {
          bookingId: p.bookingId,
          tripId: booking.trip_id,
          passengerId: booking.passenger_id,
          seats: booking.seats,
          reason: 'PAYMENT_FAILED',
        },
        traceId: event.traceId,
      },
      tx,
    );

    recordBookingTransition('PENDING_PAYMENT', 'CANCELLED');
    recordSagaOutcome('trips', 'hold', 'fail');

    this.logger.log({
      msg: 'Booking cancelled due to payment failure, seats released',
      bookingId: p.bookingId,
      seats: booking.seats,
      traceId: event.traceId,
    });
  }
}
