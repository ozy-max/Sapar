import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';

interface BookingCreatedPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
  seats: number;
  priceKgs: number;
}

@Injectable()
export class HandleBookingCreatedHandler implements EventHandler {
  readonly eventType = 'booking.created';
  private readonly logger = new Logger(HandleBookingCreatedHandler.name);

  constructor(private readonly outboxService: OutboxService) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as BookingCreatedPayload;
    const amountKgs = p.priceKgs * p.seats;

    const intent = await tx.paymentIntent.create({
      data: {
        bookingId: p.bookingId,
        payerId: p.passengerId,
        amountKgs,
        currency: 'KGS',
        status: 'HOLD_PLACED',
        pspProvider: 'event-driven',
      },
    });

    await tx.paymentEvent.create({
      data: {
        paymentIntentId: intent.id,
        type: 'HOLD_PLACED',
        payloadJson: { triggeredBy: event.eventType, bookingId: p.bookingId },
      },
    });

    await this.outboxService.publish(
      {
        eventType: 'payment.intent.hold_placed',
        payload: {
          paymentIntentId: intent.id,
          bookingId: p.bookingId,
          passengerId: p.passengerId,
          amountKgs,
        },
        traceId: event.traceId,
      },
      tx,
    );

    this.logger.log({
      msg: 'Payment intent created from booking event',
      bookingId: p.bookingId,
      paymentIntentId: intent.id,
      traceId: event.traceId,
    });
  }
}
