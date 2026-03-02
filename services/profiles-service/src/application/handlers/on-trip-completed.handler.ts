import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { RatingEligibilityRepository } from '../../adapters/db/rating-eligibility.repository';

const confirmedBookingSchema = z.object({
  bookingId: z.string().uuid(),
  passengerId: z.string().uuid(),
});

const tripCompletedPayloadSchema = z.object({
  tripId: z.string().uuid(),
  driverId: z.string().uuid(),
  completedAt: z.string(),
  confirmedBookings: z.array(confirmedBookingSchema),
});

type TripCompletedPayload = z.infer<typeof tripCompletedPayloadSchema>;

@Injectable()
export class OnTripCompletedHandler implements EventHandler {
  readonly eventType = 'trip.completed';
  private readonly logger = new Logger(OnTripCompletedHandler.name);

  constructor(private readonly eligibilityRepo: RatingEligibilityRepository) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const parsed = tripCompletedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn({
        msg: 'Invalid trip.completed payload, skipping',
        errors: parsed.error.flatten().fieldErrors,
        traceId: event.traceId,
      });
      return;
    }
    const payload: TripCompletedPayload = parsed.data;

    if (!payload.confirmedBookings?.length) {
      this.logger.debug(`trip.completed with no confirmed bookings: tripId=${payload.tripId}`);
      return;
    }

    const completedAt = new Date(payload.completedAt);

    await this.eligibilityRepo.createMany(
      payload.confirmedBookings.map((b) => ({
        tripId: payload.tripId,
        bookingId: b.bookingId,
        driverId: payload.driverId,
        passengerId: b.passengerId,
        completedAt,
      })),
      tx,
    );

    this.logger.log({
      msg: 'Rating eligibilities created',
      tripId: payload.tripId,
      count: payload.confirmedBookings.length,
      traceId: event.traceId,
    });
  }
}
