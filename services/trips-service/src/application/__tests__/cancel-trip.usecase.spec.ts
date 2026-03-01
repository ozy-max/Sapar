import { TripStatus } from '@prisma/client';
import { CancelTripUseCase } from '../cancel-trip.usecase';
import { PrismaService } from '../../adapters/db/prisma.service';
import { OutboxService } from '../../shared/outbox.service';
import {
  TripNotFoundError,
  TripNotActiveError,
  ForbiddenError,
} from '../../shared/errors';

const TRIP_ID = '00000000-0000-0000-0000-000000000001';
const DRIVER_ID = 'user-driver';
const TRACE_ID = 'trace-abc';

function makeTripRow(overrides: Record<string, unknown> = {}) {
  return { id: TRIP_ID, driver_id: DRIVER_ID, status: 'ACTIVE', ...overrides };
}

function makeTx(tripRows = [makeTripRow()]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(tripRows),
    trip: {
      update: jest.fn().mockResolvedValue(undefined),
    },
    booking: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function buildDeps(tripRows = [makeTripRow()]) {
  const tx = makeTx(tripRows);
  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>, _opts?: unknown) => cb(tx)),
  } as unknown as PrismaService;

  const outboxService = {
    publish: jest.fn().mockResolvedValue('evt-1'),
  } as unknown as OutboxService;

  const useCase = new CancelTripUseCase(prisma, outboxService);

  return { useCase, prisma, outboxService, tx };
}

const baseInput = { tripId: TRIP_ID, userId: DRIVER_ID, traceId: TRACE_ID };

describe('CancelTripUseCase', () => {
  it('should throw TripNotFoundError when trip does not exist', async () => {
    const { useCase } = buildDeps([]);

    await expect(useCase.execute(baseInput)).rejects.toThrow(TripNotFoundError);
  });

  it('should throw ForbiddenError when user is not the driver', async () => {
    const { useCase } = buildDeps();

    await expect(
      useCase.execute({ ...baseInput, userId: 'other-user' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('should throw TripNotActiveError when trip is already CANCELLED', async () => {
    const { useCase } = buildDeps([makeTripRow({ status: 'CANCELLED' })]);

    await expect(useCase.execute(baseInput)).rejects.toThrow(TripNotActiveError);
  });

  it('should throw TripNotActiveError when trip is COMPLETED', async () => {
    const { useCase } = buildDeps([makeTripRow({ status: 'COMPLETED' })]);

    await expect(useCase.execute(baseInput)).rejects.toThrow(TripNotActiveError);
  });

  it('should allow cancellation for DRAFT trips', async () => {
    const { useCase } = buildDeps([makeTripRow({ status: TripStatus.DRAFT })]);

    const result = await useCase.execute(baseInput);

    expect(result).toEqual({ tripId: TRIP_ID, status: 'CANCELLED' });
  });

  it('should cancel all active bookings and publish events for each', async () => {
    const bookings = [
      { id: 'b1', passengerId: 'p1', seats: 1, status: 'CONFIRMED' },
      { id: 'b2', passengerId: 'p2', seats: 2, status: 'PENDING_PAYMENT' },
    ];
    const { useCase, tx, outboxService } = buildDeps();
    tx.booking.findMany.mockResolvedValue(bookings);

    const result = await useCase.execute(baseInput);

    expect(result).toEqual({ tripId: TRIP_ID, status: 'CANCELLED' });

    expect(tx.trip.update).toHaveBeenCalledWith({
      where: { id: TRIP_ID },
      data: { status: TripStatus.CANCELLED },
    });
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        tripId: TRIP_ID,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      },
      data: { status: 'CANCELLED' },
    });

    // booking.cancelled for each booking + trip.cancelled
    expect(outboxService.publish).toHaveBeenCalledTimes(3);

    expect(outboxService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'booking.cancelled',
        payload: expect.objectContaining({ bookingId: 'b1', reason: 'TRIP_CANCELLED' }),
      }),
      tx,
    );
    expect(outboxService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'booking.cancelled',
        payload: expect.objectContaining({ bookingId: 'b2', reason: 'TRIP_CANCELLED' }),
      }),
      tx,
    );
    expect(outboxService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'trip.cancelled',
        payload: expect.objectContaining({ tripId: TRIP_ID, driverId: DRIVER_ID }),
      }),
      tx,
    );
  });
});
