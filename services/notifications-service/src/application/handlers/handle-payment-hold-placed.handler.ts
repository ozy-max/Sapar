import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';

const payloadSchema = z.object({
  passengerId: z.string().uuid(),
  bookingId: z.string().uuid(),
  amountKgs: z.number().int().positive(),
  paymentIntentId: z.string().uuid().optional(),
});

@Injectable()
export class HandlePaymentHoldPlacedHandler implements EventHandler {
  readonly eventType = 'payment.intent.hold_placed';
  private readonly logger = new Logger(HandlePaymentHoldPlacedHandler.name);

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const parsed = payloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({
        msg: 'Invalid event payload',
        errors: parsed.error.flatten().fieldErrors,
        eventId: event.eventId,
      });
      return;
    }
    const p = parsed.data;

    const notification = await tx.notification.create({
      data: {
        userId: p.passengerId,
        channel: 'PUSH',
        templateKey: 'PAYMENT_HOLD_PLACED',
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
