import { SearchCacheService, SearchCacheParams } from '../search-cache.service';

jest.mock('../../../observability/search-metrics', () => ({
  searchCacheHitsTotal: { inc: jest.fn() },
  searchCacheMissesTotal: { inc: jest.fn() },
  searchCacheErrorsTotal: { inc: jest.fn() },
}));

describe('SearchCacheService', () => {
  describe('normalizeKey', () => {
    it('should produce deterministic keys for same params', () => {
      const params: SearchCacheParams = {
        fromCityId: '550e8400-e29b-41d4-a716-446655440001',
        toCityId: '550e8400-e29b-41d4-a716-446655440002',
        minSeats: 1,
        limit: 20,
        offset: 0,
      };
      const key1 = SearchCacheService.normalizeKey(params);
      const key2 = SearchCacheService.normalizeKey(params);
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^trips:search:[a-f0-9]{16}$/);
    });

    it('should produce different keys for different params', () => {
      const params1: SearchCacheParams = { fromCity: 'Бишкек', toCity: 'Ош', limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromCity: 'Ош', toCity: 'Бишкек', limit: 20, offset: 0 };
      expect(SearchCacheService.normalizeKey(params1)).not.toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });

    it('should normalize city names to lowercase', () => {
      const params1: SearchCacheParams = { fromCity: 'БИШКЕК', limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromCity: 'бишкек', limit: 20, offset: 0 };
      expect(SearchCacheService.normalizeKey(params1)).toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });

    it('should round lat/lon to 4 decimal places', () => {
      const params1: SearchCacheParams = { fromLat: 42.87461234, fromLon: 74.56981234, limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromLat: 42.87462999, fromLon: 74.56982999, limit: 20, offset: 0 };
      expect(SearchCacheService.normalizeKey(params1)).toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });

    it('should produce different keys for values rounding to different 4th decimal', () => {
      const params1: SearchCacheParams = { fromLat: 42.87461, fromLon: 74.5698, limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromLat: 42.87471, fromLon: 74.5698, limit: 20, offset: 0 };
      expect(SearchCacheService.normalizeKey(params1)).not.toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });

    it('should include pagination in cache key', () => {
      const params1: SearchCacheParams = { fromCity: 'Бишкек', limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromCity: 'Бишкек', limit: 20, offset: 20 };
      expect(SearchCacheService.normalizeKey(params1)).not.toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });

    it('should not include minSeats=1 in key (default)', () => {
      const params1: SearchCacheParams = { fromCity: 'Бишкек', minSeats: 1, limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromCity: 'Бишкек', limit: 20, offset: 0 };
      expect(SearchCacheService.normalizeKey(params1)).toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });

    it('should include minSeats>1 in key', () => {
      const params1: SearchCacheParams = { fromCity: 'Бишкек', minSeats: 2, limit: 20, offset: 0 };
      const params2: SearchCacheParams = { fromCity: 'Бишкек', limit: 20, offset: 0 };
      expect(SearchCacheService.normalizeKey(params1)).not.toBe(
        SearchCacheService.normalizeKey(params2),
      );
    });
  });

  describe('isTooBoard', () => {
    it('should return true when no location filter', () => {
      expect(SearchCacheService.isTooBoard({ limit: 50, offset: 0 })).toBe(true);
    });

    it('should return false with fromCity', () => {
      expect(SearchCacheService.isTooBoard({ fromCity: 'Бишкек', limit: 50, offset: 0 })).toBe(false);
    });

    it('should return false with fromCityId', () => {
      expect(
        SearchCacheService.isTooBoard({
          fromCityId: '550e8400-e29b-41d4-a716-446655440001',
          limit: 50,
          offset: 0,
        }),
      ).toBe(false);
    });

    it('should return false with fromLat', () => {
      expect(
        SearchCacheService.isTooBoard({ fromLat: 42.87, limit: 50, offset: 0 }),
      ).toBe(false);
    });

    it('should return false with bboxMinLat', () => {
      expect(
        SearchCacheService.isTooBoard({ bboxMinLat: 40.0, limit: 50, offset: 0 }),
      ).toBe(false);
    });
  });

  describe('queryShape', () => {
    const service = new SearchCacheService(null, 15);

    it('should return "byCityId" for cityId queries', () => {
      expect(service.queryShape({ fromCityId: 'id1' })).toContain('byCityId');
    });

    it('should return "byName" for name queries', () => {
      expect(service.queryShape({ fromCity: 'Бишкек' })).toContain('byName');
    });

    it('should return "byGeo" for lat/lon queries', () => {
      expect(service.queryShape({ fromLat: 42.87, radiusKm: 25 })).toContain('byGeo');
    });

    it('should return "minimal" for empty params', () => {
      expect(service.queryShape({})).toBe('minimal');
    });
  });

  describe('get/set (no redis)', () => {
    const service = new SearchCacheService(null, 15);

    it('get should return null when redis is null', async () => {
      const result = await service.get('some-key');
      expect(result).toBeNull();
    });

    it('set should not throw when redis is null', async () => {
      await expect(service.set('some-key', { items: [] })).resolves.not.toThrow();
    });
  });

  describe('get/set (mock redis)', () => {
    it('should return cached data on hit', async () => {
      const mockRedis = {
        get: jest.fn().mockResolvedValue(JSON.stringify({ items: [], count: 0 })),
        set: jest.fn().mockResolvedValue('OK'),
      };
      const service = new SearchCacheService(mockRedis as never, 15);

      const result = await service.get<{ items: unknown[]; count: number }>('test-key');
      expect(result).toEqual({ items: [], count: 0 });
      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null on cache miss', async () => {
      const mockRedis = { get: jest.fn().mockResolvedValue(null) };
      const service = new SearchCacheService(mockRedis as never, 15);

      const result = await service.get('test-key');
      expect(result).toBeNull();
    });

    it('should return null and increment error counter on redis error', async () => {
      const mockRedis = { get: jest.fn().mockRejectedValue(new Error('connection refused')) };
      const service = new SearchCacheService(mockRedis as never, 15);

      const result = await service.get('test-key');
      expect(result).toBeNull();
    });

    it('should call set with correct TTL', async () => {
      const mockRedis = { set: jest.fn().mockResolvedValue('OK') };
      const service = new SearchCacheService(mockRedis as never, 20);

      await service.set('test-key', { data: true });
      expect(mockRedis.set).toHaveBeenCalledWith('test-key', '{"data":true}', 'EX', 20);
    });

    it('should not throw on set error (fail-open)', async () => {
      const mockRedis = { set: jest.fn().mockRejectedValue(new Error('write error')) };
      const service = new SearchCacheService(mockRedis as never, 15);

      await expect(service.set('test-key', { data: true })).resolves.not.toThrow();
    });
  });
});
