import { Injectable, Logger } from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { OutboxService } from '../shared/outbox.service';
import { TripNotFoundError, TripNotActiveError, ForbiddenError } from '../shared/errors';

interface CompleteTripInput {
  tripId: string;
  userId: string;
  traceId: string;
}

interface CompleteTripOutput {
  tripId: string;
  status: string;
  completedAt: string;
}

interface TripRow {
  id: string;
  driver_id: string;
  status: string;
  depart_at: Date;
}

interface ConfirmedBookingRow {
  id: string;
  passenger_id: string;
}

@Injectable()
export class CompleteTripUseCase {
  private readonly logger = new Logger(CompleteTripUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  async execute(input: CompleteTripInput): Promise<CompleteTripOutput> {
    const completedAt = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<TripRow[]>`
          SELECT id, driver_id, status, depart_at
          FROM trips
          WHERE id = ${input.tripId}::uuid
          FOR UPDATE
        `;
        const trip = rows[0];
        if (!trip) throw new TripNotFoundError();
        if (trip.driver_id !== input.userId) throw new ForbiddenError();
        if (trip.status !== TripStatus.ACTIVE) {
          throw new TripNotActiveError();
        }

        await tx.trip.update({
          where: { id: input.tripId },
          data: { status: TripStatus.COMPLETED, completedAt },
        });

        const confirmedBookings = await tx.$queryRaw<ConfirmedBookingRow[]>`
          SELECT id, passenger_id
          FROM bookings
          WHERE trip_id = ${input.tripId}::uuid
            AND status = 'CONFIRMED'::"BookingStatus"
        `;

        await this.outboxService.publish(
          {
            eventType: 'trip.completed',
            payload: {
              tripId: input.tripId,
              driverId: trip.driver_id,
              departAt: trip.depart_at.toISOString(),
              completedAt: completedAt.toISOString(),
              confirmedBookings: confirmedBookings.map((b) => ({
                bookingId: b.id,
                passengerId: b.passenger_id,
              })),
            },
            traceId: input.traceId,
          },
          tx,
        );
      },
      { timeout: 10_000 },
    );

    this.logger.log(`Trip completed: tripId=${input.tripId} by driverId=${input.userId}`);

    return {
      tripId: input.tripId,
      status: 'COMPLETED',
      completedAt: completedAt.toISOString(),
    };
  }
}
