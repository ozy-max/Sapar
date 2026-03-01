import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { RatingEligibilityRepository } from '../../adapters/db/rating-eligibility.repository';

interface ConfirmedBooking {
  bookingId: string;
  passengerId: string;
}

interface TripCompletedPayload {
  tripId: string;
  driverId: string;
  completedAt: string;
  confirmedBookings: ConfirmedBooking[];
}

@Injectable()
export class OnTripCompletedHandler implements EventHandler {
  readonly eventType = 'trip.completed';
  private readonly logger = new Logger(OnTripCompletedHandler.name);

  constructor(private readonly eligibilityRepo: RatingEligibilityRepository) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const payload = event.payload as unknown as TripCompletedPayload;

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
