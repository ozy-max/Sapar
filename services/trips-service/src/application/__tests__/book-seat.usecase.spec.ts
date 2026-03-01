import { Prisma } from '@prisma/client';
import { BookSeatUseCase } from '../book-seat.usecase';
import { PrismaService } from '../../adapters/db/prisma.service';
import { IdempotencyRepository } from '../../adapters/db/idempotency.repository';
import { OutboxService } from '../../shared/outbox.service';
import {
  TripNotFoundError,
  TripNotActiveError,
  NotEnoughSeatsError,
  BookingExistsError,
} from '../../shared/errors';

const TRIP_ID = '00000000-0000-0000-0000-000000000001';
const PASSENGER_ID = 'user-passenger';
const BOOKING_ID = 'booking-1';
const TRACE_ID = 'trace-abc';

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    driverId: 'user-driver',
    status: 'ACTIVE',
    seatsAvailable: 3,
    seatsTotal: 4,
    priceKgs: 1500,
    departAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

function makeTx() {
  return {
    $queryRaw: jest.fn().mockResolvedValue(undefined),
    trip: {
      findUnique: jest.fn().mockResolvedValue(makeTrip()),
      update: jest.fn().mockResolvedValue(undefined),
    },
    booking: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: BOOKING_ID,
        tripId: TRIP_ID,
        passengerId: PASSENGER_ID,
        seats: 1,
        status: 'PENDING_PAYMENT',
        createdAt: new Date('2026-06-01T09:00:00Z'),
      }),
    },
    idempotencyRecord: {
      create: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function buildDeps() {
  const tx = makeTx();
  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  const idempotencyRepo = {
    findByKeyAndUser: jest.fn().mockResolvedValue(null),
  } as unknown as IdempotencyRepository;

  const outboxService = {
    publish: jest.fn().mockResolvedValue('evt-1'),
  } as unknown as OutboxService;

  const useCase = new BookSeatUseCase(prisma, idempotencyRepo, outboxService);

  return { useCase, prisma, idempotencyRepo, outboxService, tx };
}

const baseInput = {
  tripId: TRIP_ID,
  passengerId: PASSENGER_ID,
  seats: 1,
  traceId: TRACE_ID,
};

describe('BookSeatUseCase', () => {
  it('should throw TripNotActiveError when trip status is not ACTIVE', async () => {
    const { useCase, tx } = buildDeps();
    tx.trip.findUnique.mockResolvedValue(makeTrip({ status: 'CANCELLED' }));

    await expect(useCase.execute(baseInput)).rejects.toThrow(TripNotActiveError);
  });

  it('should throw TripNotFoundError when trip does not exist', async () => {
    const { useCase, tx } = buildDeps();
    tx.trip.findUnique.mockResolvedValue(null);

    await expect(useCase.execute(baseInput)).rejects.toThrow(TripNotFoundError);
  });

  it('should throw NotEnoughSeatsError when seats requested exceed available', async () => {
    const { useCase, tx } = buildDeps();
    tx.trip.findUnique.mockResolvedValue(makeTrip({ seatsAvailable: 0 }));

    await expect(useCase.execute({ ...baseInput, seats: 2 })).rejects.toThrow(
      NotEnoughSeatsError,
    );
  });

  it('should throw BookingExistsError when passenger already has active booking', async () => {
    const { useCase, tx } = buildDeps();
    tx.booking.findFirst.mockResolvedValue({ id: 'existing', status: 'CONFIRMED' });

    await expect(useCase.execute(baseInput)).rejects.toThrow(BookingExistsError);
  });

  it('should create booking, decrement seats, and publish outbox event in transaction', async () => {
    const { useCase, tx, outboxService } = buildDeps();

    const result = await useCase.execute(baseInput);

    expect(result).toEqual({
      bookingId: BOOKING_ID,
      tripId: TRIP_ID,
      status: 'PENDING_PAYMENT',
    });
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: TRIP_ID,
        passengerId: PASSENGER_ID,
        seats: 1,
        status: 'PENDING_PAYMENT',
      }),
    });
    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: TRIP_ID },
      data: { seatsAvailable: { decrement: 1 } },
    });
    expect(outboxService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'booking.created',
        traceId: TRACE_ID,
      }),
      tx,
    );
  });

  it('should return cached response on idempotency key hit', async () => {
    const cached = { bookingId: BOOKING_ID, tripId: TRIP_ID, status: 'PENDING_PAYMENT' };
    const { useCase, idempotencyRepo, prisma } = buildDeps();
    (idempotencyRepo.findByKeyAndUser as jest.Mock).mockResolvedValue({ response: cached });

    const result = await useCase.execute({ ...baseInput, idempotencyKey: 'idem-1' });

    expect(result).toEqual(cached);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should handle P2002 idempotency collision gracefully', async () => {
    const cached = { bookingId: BOOKING_ID, tripId: TRIP_ID, status: 'PENDING_PAYMENT' };
    const { useCase, prisma, idempotencyRepo } = buildDeps();

    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    (prisma.$transaction as jest.Mock).mockRejectedValue(p2002);
    (idempotencyRepo.findByKeyAndUser as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ response: cached });

    const result = await useCase.execute({ ...baseInput, idempotencyKey: 'idem-1' });

    expect(result).toEqual(cached);
  });

  it('should rethrow non-P2002 errors', async () => {
    const { useCase, prisma } = buildDeps();
    const error = new Error('unexpected');
    (prisma.$transaction as jest.Mock).mockRejectedValue(error);

    await expect(useCase.execute(baseInput)).rejects.toThrow('unexpected');
  });
});
