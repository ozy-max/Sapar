import { Prisma } from '@prisma/client';
import { CreateRatingUseCase } from '../create-rating.usecase';
import { PrismaService } from '../../adapters/db/prisma.service';
import { RatingRepository } from '../../adapters/db/rating.repository';
import { RatingEligibilityRepository } from '../../adapters/db/rating-eligibility.repository';
import {
  NotEligibleError,
  RatingWindowExpiredError,
  DuplicateRatingError,
} from '../../shared/errors';

jest.mock('../../config/env', () => ({
  loadEnv: jest.fn().mockReturnValue({ RATING_WINDOW_DAYS: 14 }),
}));

jest.mock('../../observability/rating-metrics', () => ({
  recordRatingCreated: jest.fn(),
  recordRatingRejected: jest.fn(),
  recordAggregateUpdated: jest.fn(),
}));

const TRIP_ID = 'trip-001';
const BOOKING_ID = 'booking-001';
const PASSENGER_ID = 'user-passenger';
const DRIVER_ID = 'user-driver';
const RATING_ID = 'rating-001';

function makeEligibility(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'elig-001',
    tripId: TRIP_ID,
    bookingId: BOOKING_ID,
    driverId: DRIVER_ID,
    passengerId: PASSENGER_ID,
    completedAt: new Date(),
    ...overrides,
  };
}

function makeRating(): Record<string, unknown> {
  return {
    id: RATING_ID,
    tripId: TRIP_ID,
    bookingId: BOOKING_ID,
    raterUserId: PASSENGER_ID,
    ratedUserId: DRIVER_ID,
    role: 'PASSENGER_RATES_DRIVER',
    score: 5,
    comment: null,
    status: 'ACTIVE',
    createdAt: new Date('2026-06-01T10:00:00Z'),
  };
}

function buildDeps(): {
  useCase: CreateRatingUseCase;
  eligibilityRepo: jest.Mocked<Pick<RatingEligibilityRepository, 'findByBookingId'>>;
  ratingRepo: jest.Mocked<Pick<RatingRepository, 'createWithAggregate'>>;
  prisma: { $transaction: jest.Mock };
} {
  const eligibilityRepo = {
    findByBookingId: jest.fn().mockResolvedValue(makeEligibility()),
  };

  const ratingRepo = {
    createWithAggregate: jest.fn().mockResolvedValue(makeRating()),
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };

  const useCase = new CreateRatingUseCase(
    prisma as unknown as PrismaService,
    ratingRepo as unknown as RatingRepository,
    eligibilityRepo as unknown as RatingEligibilityRepository,
  );

  return { useCase, eligibilityRepo, ratingRepo, prisma };
}

describe('CreateRatingUseCase', () => {
  it('should throw NotEligibleError when no eligibility record exists', async () => {
    const { useCase, eligibilityRepo } = buildDeps();
    eligibilityRepo.findByBookingId.mockResolvedValue(null);

    await expect(
      useCase.execute({
        raterUserId: PASSENGER_ID,
        bookingId: BOOKING_ID,
        score: 5,
      }),
    ).rejects.toThrow(NotEligibleError);
  });

  it('should throw NotEligibleError when rater is not a participant', async () => {
    const { useCase } = buildDeps();

    await expect(
      useCase.execute({
        raterUserId: 'random-user',
        bookingId: BOOKING_ID,
        score: 5,
      }),
    ).rejects.toThrow(NotEligibleError);
  });

  it('should throw RatingWindowExpiredError when deadline passed', async () => {
    const { useCase, eligibilityRepo } = buildDeps();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    eligibilityRepo.findByBookingId.mockResolvedValue(
      makeEligibility({ completedAt: thirtyDaysAgo }) as Awaited<
        ReturnType<RatingEligibilityRepository['findByBookingId']>
      >,
    );

    await expect(
      useCase.execute({
        raterUserId: PASSENGER_ID,
        bookingId: BOOKING_ID,
        score: 5,
      }),
    ).rejects.toThrow(RatingWindowExpiredError);
  });

  it('should create rating as passenger rates driver', async () => {
    const { useCase, ratingRepo } = buildDeps();

    const result = await useCase.execute({
      raterUserId: PASSENGER_ID,
      bookingId: BOOKING_ID,
      score: 5,
    });

    expect(result.id).toBe(RATING_ID);
    expect(result.ratedUserId).toBe(DRIVER_ID);
    expect(result.role).toBe('PASSENGER_RATES_DRIVER');
    expect(result.score).toBe(5);
    expect(ratingRepo.createWithAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        raterUserId: PASSENGER_ID,
        ratedUserId: DRIVER_ID,
        role: 'PASSENGER_RATES_DRIVER',
        score: 5,
      }),
      expect.anything(),
    );
  });

  it('should create rating as driver rates passenger', async () => {
    const { useCase, ratingRepo } = buildDeps();
    ratingRepo.createWithAggregate.mockResolvedValue({
      ...makeRating(),
      raterUserId: DRIVER_ID,
      ratedUserId: PASSENGER_ID,
      role: 'DRIVER_RATES_PASSENGER',
      score: 4,
      comment: 'Good passenger',
    } as Awaited<ReturnType<RatingRepository['createWithAggregate']>>);

    const result = await useCase.execute({
      raterUserId: DRIVER_ID,
      bookingId: BOOKING_ID,
      score: 4,
      comment: 'Good passenger',
    });

    expect(result.ratedUserId).toBe(PASSENGER_ID);
    expect(result.role).toBe('DRIVER_RATES_PASSENGER');
    expect(ratingRepo.createWithAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        raterUserId: DRIVER_ID,
        ratedUserId: PASSENGER_ID,
        role: 'DRIVER_RATES_PASSENGER',
      }),
      expect.anything(),
    );
  });

  it('should throw DuplicateRatingError on P2002', async () => {
    const { useCase, prisma } = buildDeps();

    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    prisma.$transaction.mockRejectedValue(p2002);

    await expect(
      useCase.execute({
        raterUserId: PASSENGER_ID,
        bookingId: BOOKING_ID,
        score: 5,
      }),
    ).rejects.toThrow(DuplicateRatingError);
  });

  it('should rethrow non-P2002 errors', async () => {
    const { useCase, prisma } = buildDeps();
    const error = new Error('unexpected');
    prisma.$transaction.mockRejectedValue(error);

    await expect(
      useCase.execute({
        raterUserId: PASSENGER_ID,
        bookingId: BOOKING_ID,
        score: 5,
      }),
    ).rejects.toThrow('unexpected');
  });
});
