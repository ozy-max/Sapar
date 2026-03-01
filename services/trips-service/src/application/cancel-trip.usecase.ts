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

      await tx.booking.updateMany({
        where: {
          tripId: input.tripId,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        },
        data: { status: 'CANCELLED' },
      });

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
    });

    this.logger.log(`Trip cancelled: tripId=${input.tripId} by driverId=${input.userId}`);

    return { tripId: input.tripId, status: 'CANCELLED' };
  }
}
