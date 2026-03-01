import { SearchTripsUseCase } from '../search-trips.usecase';
import { TripRepository } from '../../adapters/db/trip.repository';
import { CityRepository } from '../../adapters/db/city.repository';
import { SearchCacheService } from '../../adapters/redis/search-cache.service';

jest.mock('../../observability/search-metrics', () => ({
  tripsSearchRequestsTotal: { inc: jest.fn() },
  tripsSearchDurationMs: { observe: jest.fn() },
  tripsSearchDbRowsReturned: { observe: jest.fn() },
}));

function makeTripEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    driverId: 'driver-1',
    fromCity: 'Бишкек',
    toCity: 'Ош',
    fromCityId: 'city-1',
    toCityId: 'city-2',
    fromLat: 42.8746,
    fromLon: 74.5698,
    toLat: 40.5283,
    toLon: 72.7985,
    departAt: new Date('2026-06-15T08:00:00Z'),
    seatsTotal: 4,
    seatsAvailable: 2,
    priceKgs: 5000,
    status: 'ACTIVE',
    completedAt: null,
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

  const cityRepo = {
    findById: jest.fn().mockResolvedValue(null),
    findByName: jest.fn().mockResolvedValue(null),
  } as unknown as CityRepository;

  const cache = new SearchCacheService(null, 0);

  const useCase = new SearchTripsUseCase(tripRepo, cityRepo, cache);

  return { useCase, tripRepo, cityRepo, cache };
}

const baseInput = {
  fromCity: 'Бишкек',
  toCity: 'Ош',
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
      fromCity: 'Бишкек',
      toCity: 'Ош',
      fromCityId: 'city-1',
      toCityId: 'city-2',
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
        dateFrom: new Date('2026-06-01T00:00:00Z'),
        dateTo: new Date('2026-06-30T23:59:59Z'),
        minSeats: 1,
        limit: 20,
        offset: 0,
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

  it('should resolve fromCity name to cityId via CityRepository', async () => {
    const { useCase, cityRepo, tripRepo } = buildDeps();
    (cityRepo.findByName as jest.Mock).mockResolvedValueOnce({
      id: 'city-bishkek',
      name: 'Бишкек',
      countryCode: 'KG',
      lat: 42.8746,
      lon: 74.5698,
    });

    await useCase.execute(baseInput);

    expect(cityRepo.findByName).toHaveBeenCalledWith('Бишкек');
    expect(tripRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({ fromCityId: 'city-bishkek' }),
    );
  });

  it('should resolve fromCityId to coords via CityRepository', async () => {
    const { useCase, cityRepo, tripRepo } = buildDeps();
    (cityRepo.findById as jest.Mock).mockResolvedValueOnce({
      id: 'city-osh',
      name: 'Ош',
      countryCode: 'KG',
      lat: 40.5283,
      lon: 72.7985,
    });

    await useCase.execute({
      fromCityId: 'city-osh',
      minSeats: 1,
      limit: 20,
      offset: 0,
    });

    expect(cityRepo.findById).toHaveBeenCalledWith('city-osh');
    expect(tripRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        fromLat: 40.5283,
        fromLon: 72.7985,
      }),
    );
  });

  it('should use geo coordinates directly without city resolution', async () => {
    const { useCase, cityRepo, tripRepo } = buildDeps();

    await useCase.execute({
      fromLat: 42.87,
      fromLon: 74.57,
      radiusKm: 50,
      minSeats: 1,
      limit: 20,
      offset: 0,
    });

    expect(cityRepo.findByName).not.toHaveBeenCalled();
    expect(cityRepo.findById).not.toHaveBeenCalled();
    expect(tripRepo.search).toHaveBeenCalledWith(
      expect.objectContaining({
        fromLat: 42.87,
        fromLon: 74.57,
        radiusKm: 50,
      }),
    );
  });
});
