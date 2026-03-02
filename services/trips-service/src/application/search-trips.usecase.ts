import { Injectable, Logger } from '@nestjs/common';
import { TripRepository } from '../adapters/db/trip.repository';
import { CityRepository } from '../adapters/db/city.repository';
import { SearchCacheService } from '../adapters/redis/search-cache.service';
import {
  tripsSearchRequestsTotal,
  tripsSearchDurationMs,
  tripsSearchDbRowsReturned,
} from '../observability/search-metrics';

export interface SearchTripsInput {
  fromCity?: string;
  toCity?: string;
  fromCityId?: string;
  toCityId?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  radiusKm?: number;
  bboxMinLat?: number;
  bboxMinLon?: number;
  bboxMaxLat?: number;
  bboxMaxLon?: number;
  dateFrom?: string;
  dateTo?: string;
  minSeats: number;
  priceMin?: number;
  priceMax?: number;
  limit: number;
  offset: number;
}

interface TripItem {
  tripId: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  fromCityId: string | null;
  toCityId: string | null;
  departAt: string;
  seatsTotal: number;
  seatsAvailable: number;
  priceKgs: number;
  status: string;
}

interface SearchTripsOutput {
  items: TripItem[];
  count: number;
}

@Injectable()
export class SearchTripsUseCase {
  private readonly logger = new Logger(SearchTripsUseCase.name);
  private readonly defaultRadiusKm: number;

  constructor(
    private readonly tripRepo: TripRepository,
    private readonly cityRepo: CityRepository,
    private readonly cache: SearchCacheService,
  ) {
    this.defaultRadiusKm = 25;
  }

  async execute(input: SearchTripsInput, traceId?: string): Promise<SearchTripsOutput> {
    const startMs = Date.now();
    const radiusKm = input.radiusKm ?? this.defaultRadiusKm;

    try {
      const resolved = await this.resolveCityCoords(input);
      const cacheParams = { ...input, ...resolved, radiusKm };
      const queryShape = this.cache.queryShape(cacheParams);

      this.logger.log({ msg: 'search_start', queryShape, traceId });

      if (!SearchCacheService.isTooBroad(cacheParams)) {
        const cacheKey = SearchCacheService.normalizeKey(cacheParams);
        const cached = await this.cache.get<SearchTripsOutput>(cacheKey);
        if (cached) {
          tripsSearchRequestsTotal.inc({ result: 'cache_hit' });
          tripsSearchDurationMs.observe(Date.now() - startMs);
          return cached;
        }
      }

      const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined;
      const dateTo = input.dateTo ? new Date(input.dateTo) : undefined;

      const repoParams = {
        fromCity: input.fromCity,
        toCity: input.toCity,
        fromCityId: resolved.fromCityId ?? input.fromCityId,
        toCityId: resolved.toCityId ?? input.toCityId,
        fromLat: resolved.fromLat ?? input.fromLat,
        fromLon: resolved.fromLon ?? input.fromLon,
        toLat: resolved.toLat ?? input.toLat,
        toLon: resolved.toLon ?? input.toLon,
        radiusKm,
        bboxMinLat: input.bboxMinLat,
        bboxMinLon: input.bboxMinLon,
        bboxMaxLat: input.bboxMaxLat,
        bboxMaxLon: input.bboxMaxLon,
        dateFrom,
        dateTo,
        minSeats: input.minSeats,
        priceMin: input.priceMin,
        priceMax: input.priceMax,
        limit: input.limit,
        offset: input.offset,
      };

      const [trips, totalCount] = await Promise.all([
        this.tripRepo.search(repoParams),
        this.tripRepo.searchCount(repoParams),
      ]);

      tripsSearchDbRowsReturned.observe(trips.length);

      const items: TripItem[] = trips.map((t) => ({
        tripId: t.id,
        driverId: t.driverId,
        fromCity: t.fromCity,
        toCity: t.toCity,
        fromCityId: t.fromCityId,
        toCityId: t.toCityId,
        departAt: t.departAt.toISOString(),
        seatsTotal: t.seatsTotal,
        seatsAvailable: t.seatsAvailable,
        priceKgs: t.priceKgs,
        status: t.status,
      }));

      const result: SearchTripsOutput = { items, count: totalCount };

      if (!SearchCacheService.isTooBroad(cacheParams)) {
        const cacheKey = SearchCacheService.normalizeKey(cacheParams);
        void this.cache.set(cacheKey, result);
      }

      tripsSearchRequestsTotal.inc({ result: 'success' });
      tripsSearchDurationMs.observe(Date.now() - startMs);
      return result;
    } catch (err) {
      tripsSearchRequestsTotal.inc({ result: 'error' });
      tripsSearchDurationMs.observe(Date.now() - startMs);
      throw err;
    }
  }

  /**
   * If caller provides fromCityId but no coords, resolve city to get lat/lon.
   * If caller provides fromCity string, try to resolve to cityId for better indexing.
   */
  private async resolveCityCoords(input: SearchTripsInput): Promise<{
    fromCityId?: string;
    toCityId?: string;
    fromLat?: number;
    fromLon?: number;
    toLat?: number;
    toLon?: number;
  }> {
    const result: {
      fromCityId?: string;
      toCityId?: string;
      fromLat?: number;
      fromLon?: number;
      toLat?: number;
      toLon?: number;
    } = {};

    if (input.fromCityId && input.fromLat == null) {
      const city = await this.cityRepo.findById(input.fromCityId);
      if (city) {
        result.fromLat = city.lat;
        result.fromLon = city.lon;
      }
    } else if (input.fromCity && !input.fromCityId && input.fromLat == null) {
      const city = await this.cityRepo.findByName(input.fromCity);
      if (city) {
        result.fromCityId = city.id;
        result.fromLat = city.lat;
        result.fromLon = city.lon;
      }
    }

    if (input.toCityId && input.toLat == null) {
      const city = await this.cityRepo.findById(input.toCityId);
      if (city) {
        result.toLat = city.lat;
        result.toLon = city.lon;
      }
    } else if (input.toCity && !input.toCityId && input.toLat == null) {
      const city = await this.cityRepo.findByName(input.toCity);
      if (city) {
        result.toCityId = city.id;
        result.toLat = city.lat;
        result.toLon = city.lon;
      }
    }

    return result;
  }
}
