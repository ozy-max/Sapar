import { SearchTripsUseCase } from '../search-trips.usecase';
import { TripRepository } from '../../adapters/db/trip.repository';

function makeTripEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    driverId: 'driver-1',
    fromCity: 'Almaty',
    toCity: 'Astana',
    departAt: new Date('2026-06-15T08:00:00Z'),
    seatsTotal: 4,
    seatsAvailable: 2,
    priceKgs: 5000,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildDeps() {
  const tripRepo = {
    search: jest.fn().mockResolvedValue([]),
    searchCount: jest.fn().mockResolvedValue(0),
  } as unknown as TripRepository;

  const useCase = new SearchTripsUseCase(tripRepo);

  return { useCase, tripRepo };
}

const baseInput = {
  fromCity: 'Almaty',
  toCity: 'Astana',
  minSeats: 1,
  limit: 20,
  offset: 0,
};

describe('SearchTripsUseCase', () => {
  it('should return trips mapped to TripItem with correct totalCount', async () => {
    const trip = makeTripEntity();
    const { useCase, tripRepo } = buildDeps();
    (tripRepo.search as jest.Mock).mockResolvedValue([trip]);
    (tripRepo.searchCount as jest.Mock).mockResolvedValue(1);

    const result = await useCase.execute(baseInput);

    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      tripId: 'trip-1',
      driverId: 'driver-1',
      fromCity: 'Almaty',
      toCity: 'Astana',
      departAt: '2026-06-15T08:00:00.000Z',
      seatsTotal: 4,
      seatsAvailable: 2,
      priceKgs: 5000,
      status: 'ACTIVE',
    });
  });

  it('should return empty items when no trips match', async () => {
    const { useCase } = buildDeps();

    const result = await useCase.execute(baseInput);

    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('should pass date filters to repository', async () => {
    const { useCase, tripRepo } = buildDeps();
    const input = {
      ...baseInput,
      dateFrom: '2026-06-01T00:00:00Z',
      dateTo: '2026-06-30T23:59:59Z',
    };

    await useCase.execute(input);

    expect(tripRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCity: 'Almaty',
        toCity: 'Astana',
        dateFrom: new Date('2026-06-01T00:00:00Z'),
        dateTo: new Date('2026-06-30T23:59:59Z'),
        minSeats: 1,
        limit: 20,
        offset: 0,
      }),
    );
    expect(tripRepo.searchCount).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCity: 'Almaty',
        toCity: 'Astana',
        dateFrom: new Date('2026-06-01T00:00:00Z'),
        dateTo: new Date('2026-06-30T23:59:59Z'),
        minSeats: 1,
      }),
    );
  });

  it('should not pass date filters when not provided', async () => {
    const { useCase, tripRepo } = buildDeps();

    await useCase.execute(baseInput);

    expect(tripRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: undefined,
        dateTo: undefined,
      }),
    );
  });

  it('should pass limit and offset for pagination', async () => {
    const { useCase, tripRepo } = buildDeps();

    await useCase.execute({ ...baseInput, limit: 10, offset: 20 });

    expect(tripRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
  });
});
