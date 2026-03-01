import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import {
  searchCacheHitsTotal,
  searchCacheMissesTotal,
  searchCacheErrorsTotal,
} from '../../observability/search-metrics';

export interface SearchCacheParams {
  fromCityId?: string;
  toCityId?: string;
  fromCity?: string;
  toCity?: string;
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
  minSeats?: number;
  priceMin?: number;
  priceMax?: number;
  limit?: number;
  offset?: number;
}

@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);

  constructor(
    private readonly redis: Redis | null,
    private readonly ttlSec: number,
  ) {}

  static normalizeKey(params: SearchCacheParams): string {
    const parts: string[] = [];

    if (params.fromCityId) parts.push(`fci:${params.fromCityId}`);
    if (params.toCityId) parts.push(`tci:${params.toCityId}`);
    if (params.fromCity) parts.push(`fc:${params.fromCity.toLowerCase().trim()}`);
    if (params.toCity) parts.push(`tc:${params.toCity.toLowerCase().trim()}`);
    if (params.fromLat != null) parts.push(`flat:${params.fromLat.toFixed(4)}`);
    if (params.fromLon != null) parts.push(`flon:${params.fromLon.toFixed(4)}`);
    if (params.toLat != null) parts.push(`tlat:${params.toLat.toFixed(4)}`);
    if (params.toLon != null) parts.push(`tlon:${params.toLon.toFixed(4)}`);
    if (params.radiusKm != null) parts.push(`r:${params.radiusKm}`);
    if (params.bboxMinLat != null) parts.push(`bblat:${params.bboxMinLat.toFixed(4)}`);
    if (params.bboxMinLon != null) parts.push(`bblon:${params.bboxMinLon.toFixed(4)}`);
    if (params.bboxMaxLat != null) parts.push(`bblax:${params.bboxMaxLat.toFixed(4)}`);
    if (params.bboxMaxLon != null) parts.push(`bblox:${params.bboxMaxLon.toFixed(4)}`);
    if (params.dateFrom) parts.push(`df:${params.dateFrom}`);
    if (params.dateTo) parts.push(`dt:${params.dateTo}`);
    if (params.minSeats != null && params.minSeats > 1) parts.push(`ms:${params.minSeats}`);
    if (params.priceMin != null) parts.push(`pmin:${params.priceMin}`);
    if (params.priceMax != null) parts.push(`pmax:${params.priceMax}`);
    parts.push(`l:${params.limit ?? 50}`);
    parts.push(`o:${params.offset ?? 0}`);

    const raw = parts.sort().join('|');
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `trips:search:${hash}`;
  }

  static isTooBoard(params: SearchCacheParams): boolean {
    const hasLocationFilter =
      params.fromCityId ||
      params.toCityId ||
      params.fromCity ||
      params.toCity ||
      params.fromLat != null ||
      params.bboxMinLat != null;
    return !hasLocationFilter;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        searchCacheMissesTotal.inc();
        return null;
      }
      searchCacheHitsTotal.inc();
      return JSON.parse(raw) as T;
    } catch (err) {
      searchCacheErrorsTotal.inc();
      this.logger.warn(`Cache GET error: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.redis || this.ttlSec <= 0) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSec);
    } catch (err) {
      searchCacheErrorsTotal.inc();
      this.logger.warn(`Cache SET error: ${(err as Error).message}`);
    }
  }

  queryShape(params: SearchCacheParams): string {
    const parts: string[] = [];
    if (params.fromCityId) parts.push('byCityId');
    else if (params.fromCity) parts.push('byName');
    if (params.fromLat != null) parts.push('byGeo');
    if (params.bboxMinLat != null) parts.push('byBbox');
    if (params.radiusKm) parts.push(`r=${params.radiusKm}km`);
    if (params.dateFrom || params.dateTo) parts.push('dated');
    if (params.priceMin != null || params.priceMax != null) parts.push('priced');
    return parts.join('+') || 'minimal';
  }
}
