import { Injectable } from '@nestjs/common';
import { Rating, RatingAggregate, RatingStatus, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface CreateRatingData {
  tripId: string;
  bookingId: string;
  raterUserId: string;
  ratedUserId: string;
  role: 'DRIVER_RATES_PASSENGER' | 'PASSENGER_RATES_DRIVER';
  score: number;
  comment?: string | null;
}

@Injectable()
export class RatingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWithAggregate(
    data: CreateRatingData,
    tx: Prisma.TransactionClient,
  ): Promise<Rating> {
    const rating = await tx.rating.create({ data });

    const agg = await tx.ratingAggregate.findUnique({
      where: { userId: data.ratedUserId },
    });

    if (agg) {
      const newCount = agg.ratingCount + 1;
      const newSum = agg.ratingSum + data.score;
      await tx.ratingAggregate.update({
        where: { userId: data.ratedUserId },
        data: {
          ratingCount: newCount,
          ratingSum: newSum,
          ratingAvg: newSum / newCount,
        },
      });
    } else {
      await tx.ratingAggregate.create({
        data: {
          userId: data.ratedUserId,
          ratingCount: 1,
          ratingSum: data.score,
          ratingAvg: data.score,
        },
      });
    }

    return rating;
  }

  async findById(id: string): Promise<Rating | null> {
    return this.prisma.rating.findUnique({ where: { id } });
  }

  async softDelete(
    id: string,
    ratedUserId: string,
    score: number,
    tx: Prisma.TransactionClient,
  ): Promise<Rating> {
    const rating = await tx.rating.update({
      where: { id },
      data: { status: RatingStatus.DELETED },
    });

    const agg = await tx.ratingAggregate.findUnique({
      where: { userId: ratedUserId },
    });

    if (agg && agg.ratingCount > 0) {
      const newCount = agg.ratingCount - 1;
      const newSum = agg.ratingSum - score;
      await tx.ratingAggregate.update({
        where: { userId: ratedUserId },
        data: {
          ratingCount: newCount,
          ratingSum: newSum,
          ratingAvg: newCount > 0 ? newSum / newCount : 0,
        },
      });
    }

    return rating;
  }

  async findByRatedUser(
    ratedUserId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: Rating[]; total: number }> {
    const where: Prisma.RatingWhereInput = {
      ratedUserId,
      status: RatingStatus.ACTIVE,
    };

    const [items, total] = await Promise.all([
      this.prisma.rating.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.rating.count({ where }),
    ]);

    return { items, total };
  }

  async getAggregate(userId: string): Promise<RatingAggregate | null> {
    return this.prisma.ratingAggregate.findUnique({ where: { userId } });
  }
}
