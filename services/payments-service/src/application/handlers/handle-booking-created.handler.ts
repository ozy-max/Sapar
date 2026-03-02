import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { recordSagaOutcome } from '../../observability/saga-metrics';

interface BookingCreatedPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
  seats: number;
  amountKgs: number;
  currency?: string;
  departAt?: string;
  createdAt?: string;
}

@Injectable()
export class HandleBookingCreatedHandler implements EventHandler {
  readonly eventType = 'booking.created';
  private readonly logger = new Logger(HandleBookingCreatedHandler.name);

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as BookingCreatedPayload;
    const amountKgs = p.amountKgs ?? 0;
    const currency = p.currency ?? 'KGS';

    const existing = await tx.paymentIntent.findUnique({
      where: { bookingId: p.bookingId },
      select: { id: true, status: true },
    });
    if (existing) {
      this.logger.log({
        msg: 'Payment intent already exists for booking',
        bookingId: p.bookingId,
        status: existing.status,
        traceId: event.traceId,
      });
      return;
    }

    const intent = await tx.paymentIntent.create({
      data: {
        bookingId: p.bookingId,
        payerId: p.passengerId,
        amountKgs,
        currency,
        status: 'HOLD_REQUESTED',
        pspProvider: 'event-driven',
      },
    });

    await tx.paymentEvent.create({
      data: {
        paymentIntentId: intent.id,
        type: 'INTENT_CREATED',
        payloadJson: {
          triggeredBy: event.eventType,
          bookingId: p.bookingId,
          amountKgs,
          currency,
        },
      },
    });

    recordSagaOutcome('payments', 'hold_requested', 'success');

    this.logger.log({
      msg: 'Payment intent created with HOLD_REQUESTED, awaiting worker pickup',
      bookingId: p.bookingId,
      paymentIntentId: intent.id,
      traceId: event.traceId,
    });
  }
}
