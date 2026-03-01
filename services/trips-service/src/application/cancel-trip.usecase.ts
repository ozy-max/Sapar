import { Injectable, Logger } from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { OutboxService } from '../shared/outbox.service';
import { TripNotFoundError, TripNotActiveError, ForbiddenError } from '../shared/errors';

interface CancelTripInput {
  tripId: string;
  userId: string;
  traceId: string;
}

interface CancelTripOutput {
  tripId: string;
  status: string;
}

interface TripRow {
  id: string;
  driver_id: string;
  status: string;
}

@Injectable()
export class CancelTripUseCase {
  private readonly logger = new Logger(CancelTripUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Driver-initiated cancellation — requires ownership check and ACTIVE/DRAFT status.
   * Intentionally separate from AdminCommandWorker.cancelTrip which has
   * different auth rules, status checks, and event payloads.
   */
  async execute(input: CancelTripInput): Promise<CancelTripOutput> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<TripRow[]>`
        SELECT id, driver_id, status
        FROM trips
        WHERE id = ${input.tripId}::uuid
        FOR UPDATE
      `;
      const trip = rows[0];
      if (!trip) throw new TripNotFoundError();
      if (trip.driver_id !== input.userId) throw new ForbiddenError();
      if (trip.status !== TripStatus.ACTIVE && trip.status !== TripStatus.DRAFT) {
        throw new TripNotActiveError();
      }

      await tx.trip.update({
        where: { id: input.tripId },
        data: { status: TripStatus.CANCELLED },
      });

      const bookingsToCancel = await tx.booking.findMany({
        where: {
          tripId: input.tripId,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        },
        select: { id: true, passengerId: true, seats: true, status: true },
      });

      await tx.booking.updateMany({
        where: {
          tripId: input.tripId,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        },
        data: { status: 'CANCELLED' },
      });

      for (const booking of bookingsToCancel) {
        await this.outboxService.publish(
          {
            eventType: 'booking.cancelled',
            payload: {
              bookingId: booking.id,
              tripId: input.tripId,
              passengerId: booking.passengerId,
              seats: booking.seats,
              reason: 'TRIP_CANCELLED',
            },
            traceId: input.traceId,
          },
          tx,
        );
      }

      await this.outboxService.publish(
        {
          eventType: 'trip.cancelled',
          payload: {
            tripId: input.tripId,
            driverId: trip.driver_id,
          },
          traceId: input.traceId,
        },
        tx,
      );
    }, { timeout: 10_000 });

    this.logger.log(`Trip cancelled: tripId=${input.tripId} by driverId=${input.userId}`);

    return { tripId: input.tripId, status: 'CANCELLED' };
  }
}
