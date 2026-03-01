import { Injectable } from '@nestjs/common';
import { RatingEligibility, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class RatingEligibilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByBookingId(bookingId: string): Promise<RatingEligibility | null> {
    return this.prisma.ratingEligibility.findFirst({ where: { bookingId } });
  }

  async createMany(
    data: Array<{
      tripId: string;
      bookingId: string;
      driverId: string;
      passengerId: string;
      completedAt: Date;
    }>,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const item of data) {
      await tx.ratingEligibility.upsert({
        where: {
          tripId_passengerId: {
            tripId: item.tripId,
            passengerId: item.passengerId,
          },
        },
        create: item,
        update: {},
      });
    }
  }
}
