import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';

interface PaymentHoldPlacedPayload {
  paymentIntentId: string;
  bookingId: string;
  passengerId: string;
  amountKgs: number;
}

@Injectable()
export class HandlePaymentHoldPlacedHandler implements EventHandler {
  readonly eventType = 'payment.intent.hold_placed';
  private readonly logger = new Logger(HandlePaymentHoldPlacedHandler.name);

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as PaymentHoldPlacedPayload;

    const notification = await tx.notification.create({
      data: {
        userId: p.passengerId,
        channel: 'PUSH',
        templateKey: 'payment_hold_placed',
        payloadJson: {
          bookingId: p.bookingId,
          paymentIntentId: p.paymentIntentId,
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
      msg: 'Notification enqueued from payment hold event',
      notificationId: notification.id,
      userId: p.passengerId,
      traceId: event.traceId,
    });
  }
}
