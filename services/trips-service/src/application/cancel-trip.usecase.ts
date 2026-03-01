import { Injectable, Logger } from '@nestjs/common';
import { TripStatus, BookingStatus } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { TripRepository } from '../adapters/db/trip.repository';
import { TripNotFoundError, TripNotActiveError, ForbiddenError } from '../shared/errors';

interface CancelTripInput {
  tripId: string;
  userId: string;
}

interface CancelTripOutput {
  tripId: string;
  status: string;
}

@Injectable()
export class CancelTripUseCase {
  private readonly logger = new Logger(CancelTripUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tripRepo: TripRepository,
  ) {}

  async execute(input: CancelTripInput): Promise<CancelTripOutput> {
    const trip = await this.tripRepo.findById(input.tripId);
    if (!trip) throw new TripNotFoundError();

    if (trip.driverId !== input.userId) throw new ForbiddenError();

    if (trip.status !== TripStatus.ACTIVE && trip.status !== TripStatus.DRAFT) {
      throw new TripNotActiveError();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id: input.tripId },
        data: { status: TripStatus.CANCELLED },
      });

      await tx.booking.updateMany({
        where: { tripId: input.tripId, status: BookingStatus.ACTIVE },
        data: { status: BookingStatus.CANCELLED },
      });
    });

    this.logger.log(`Trip cancelled: tripId=${input.tripId} by driverId=${input.userId}`);

    return { tripId: input.tripId, status: 'CANCELLED' };
  }
}
