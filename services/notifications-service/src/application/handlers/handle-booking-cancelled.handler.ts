import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';

const payloadSchema = z.object({
  bookingId: z.string().uuid(),
  tripId: z.string().uuid().optional(),
  passengerId: z.string().uuid(),
  seats: z.number().int().positive().optional(),
  reason: z.string().min(1),
});

@Injectable()
export class HandleBookingCancelledHandler implements EventHandler {
  readonly eventType = 'booking.cancelled';
  private readonly logger = new Logger(HandleBookingCancelledHandler.name);

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const parsed = payloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({
        msg: 'Invalid booking.cancelled payload',
        errors: parsed.error.flatten().fieldErrors,
        eventId: event.eventId,
      });
      return;
    }
    const p = parsed.data;

    const notification = await tx.notification.create({
      data: {
        userId: p.passengerId,
        channel: 'SMS',
        templateKey: 'BOOKING_CANCELLED',
        payloadJson: {
          bookingId: p.bookingId,
          reason: p.reason,
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
      msg: 'Booking cancelled notification enqueued',
      notificationId: notification.id,
      userId: p.passengerId,
      bookingId: p.bookingId,
      traceId: event.traceId,
    });
  }
}
