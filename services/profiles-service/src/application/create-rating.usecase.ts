import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { RatingRepository } from '../adapters/db/rating.repository';
import { RatingEligibilityRepository } from '../adapters/db/rating-eligibility.repository';
import { loadEnv } from '../config/env';
import { NotEligibleError, RatingWindowExpiredError, DuplicateRatingError } from '../shared/errors';
import {
  recordRatingCreated,
  recordRatingRejected,
  recordAggregateUpdated,
} from '../observability/rating-metrics';

interface CreateRatingInput {
  raterUserId: string;
  bookingId: string;
  score: number;
  comment?: string | null;
}

interface CreateRatingOutput {
  id: string;
  tripId: string;
  ratedUserId: string;
  role: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

@Injectable()
export class CreateRatingUseCase {
  private readonly logger = new Logger(CreateRatingUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ratingRepo: RatingRepository,
    private readonly eligibilityRepo: RatingEligibilityRepository,
  ) {}

  async execute(input: CreateRatingInput): Promise<CreateRatingOutput> {
    const eligibility = await this.eligibilityRepo.findByBookingId(input.bookingId);
    if (!eligibility) {
      recordRatingRejected('not_eligible');
      throw new NotEligibleError('no completed trip found for this booking');
    }

    let ratedUserId: string;
    let role: 'DRIVER_RATES_PASSENGER' | 'PASSENGER_RATES_DRIVER';

    if (input.raterUserId === eligibility.passengerId) {
      role = 'PASSENGER_RATES_DRIVER';
      ratedUserId = eligibility.driverId;
    } else if (input.raterUserId === eligibility.driverId) {
      role = 'DRIVER_RATES_PASSENGER';
      ratedUserId = eligibility.passengerId;
    } else {
      recordRatingRejected('not_participant');
      throw new NotEligibleError('you are not a participant of this trip');
    }

    const env = loadEnv();
    const windowMs = env.RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const deadline = new Date(eligibility.completedAt.getTime() + windowMs);
    if (new Date() > deadline) {
      recordRatingRejected('window_expired');
      throw new RatingWindowExpiredError();
    }

    try {
      const rating = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          return this.ratingRepo.createWithAggregate(
            {
              tripId: eligibility.tripId,
              bookingId: eligibility.bookingId,
              raterUserId: input.raterUserId,
              ratedUserId,
              role,
              score: input.score,
              comment: input.comment ?? null,
            },
            tx,
          );
        },
        { timeout: 10_000 },
      );

      recordRatingCreated(role);
      recordAggregateUpdated();

      this.logger.log({
        msg: 'Rating created',
        ratingId: rating.id,
        tripId: eligibility.tripId,
        role,
        raterUserId: input.raterUserId,
      });

      return {
        id: rating.id,
        tripId: rating.tripId,
        ratedUserId: rating.ratedUserId,
        role: rating.role,
        score: rating.score,
        comment: rating.comment,
        createdAt: rating.createdAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        recordRatingRejected('duplicate');
        throw new DuplicateRatingError();
      }
      throw error;
    }
  }
}
