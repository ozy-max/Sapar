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
export class HandlePaymentCapturedHandler implements EventHandler {
  readonly eventType = 'payment.captured';
  private readonly logger = new Logger(HandlePaymentCapturedHandler.name);

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
