import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';

interface PaymentCapturedPayload {
  paymentIntentId: string;
  bookingId: string;
  passengerId: string;
  amountKgs: number;
}

@Injectable()
export class HandlePaymentCapturedHandler implements EventHandler {
  readonly eventType = 'payment.captured';
  private readonly logger = new Logger(HandlePaymentCapturedHandler.name);

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as PaymentCapturedPayload;

    const notification = await tx.notification.create({
      data: {
        userId: p.passengerId,
        channel: 'PUSH',
        templateKey: 'BOOKING_CONFIRMED',
        payloadJson: {
          bookingId: p.bookingId,
          amountKgs: p.amountKgs,
        },
        status: 'PENDING',
        nextRetryAt: new Date(),
      },
    });

    await tx.notificationEvent.create({
      data: {
        notificationId: notification.id,
        type: 'ENQUEUED',
        payloadJson: { triggeredBy: event.eventType },
      },
    });

    this.logger.log({
      msg: 'BOOKING_CONFIRMED notification enqueued from payment.captured',
      notificationId: notification.id,
      userId: p.passengerId,
      bookingId: p.bookingId,
      traceId: event.traceId,
    });
  }
}
