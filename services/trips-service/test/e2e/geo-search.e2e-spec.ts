import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';

const DRIVER_ID = '00000000-0000-4000-a000-000000000001';

describe('Geo Search E2E', () => {
  let ctx: TestContext;
  let bishkekCityId: string;
  let oshCityId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const cities = await ctx.prisma.city.findMany({ where: { countryCode: 'KG' } });
    if (cities.length === 0) {
      await ctx.prisma.$executeRawUnsafe(`
        INSERT INTO "cities" ("id", "name", "country_code", "lat", "lon") VALUES
          (gen_random_uuid(), 'Бишкек', 'KG', 42.8746, 74.5698),
          (gen_random_uuid(), 'Ош', 'KG', 40.5283, 72.7985),
          (gen_random_uuid(), 'Каракол', 'KG', 42.4907, 78.3936)
        ON CONFLICT DO NOTHING
      `);
    }

    const bishkek = await ctx.prisma.city.findFirst({ where: { name: 'Бишкек' } });
    const osh = await ctx.prisma.city.findFirst({ where: { name: 'Ош' } });
    bishkekCityId = bishkek!.id;
    oshCityId = osh!.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  async function createTripWithCity(
    fromCityId: string,
    toCityId: string,
    fromCity: string,
    toCity: string,
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number,
  ): Promise<string> {
    const trip = await ctx.prisma.trip.create({
      data: {
        driverId: DRIVER_ID,
        fromCity,
        toCity,
        fromCityId,
        toCityId,
        fromLat,
        fromLon,
        toLat,
        toLon,
        departAt: new Date('2026-06-15T08:00:00Z'),
        seatsTotal: 4,
        seatsAvailable: 4,
        priceKgs: 5000,
        status: 'ACTIVE',
      },
    });
    return trip.id;
  }

  // ─── 1) Search by cityId ──────────────────────────────────────
  describe('search by cityId', () => {
    it('should return trips matching fromCityId', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCityId: bishkekCityId, toCityId: oshCityId })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].fromCity).toBe('Бишкек');
      expect(res.body.items[0].toCity).toBe('Ош');
      expect(res.body.items[0].fromCityId).toBe(bishkekCityId);
    });

    it('should return empty for non-matching cityId', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCityId: oshCityId, toCityId: bishkekCityId })
        .expect(200);

      expect(res.body.items).toHaveLength(0);
    });
  });

  // ─── 2) Backward compatible: search by city name ──────────────
  describe('backward compatibility (city name)', () => {
    it('should find trips by fromCity/toCity string names', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Бишкек', toCity: 'Ош' })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
    });
  });

  // ─── 3) Radius filter ─────────────────────────────────────────
  describe('radius filter', () => {
    it('should find trips within radius', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({
          fromLat: 42.87,
          fromLon: 74.57,
          radiusKm: 10,
        })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
    });

    it('should NOT find trips outside radius', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({
          fromLat: 40.0,
          fromLon: 70.0,
          radiusKm: 5,
        })
        .expect(200);

      expect(res.body.items).toHaveLength(0);
    });
  });

  // ─── 4) Cache hit/miss ────────────────────────────────────────
  describe('cache behavior', () => {
    it('should return same results on cache hit (second identical request)', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res1 = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCityId: bishkekCityId, toCityId: oshCityId })
        .expect(200);

      const res2 = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCityId: bishkekCityId, toCityId: oshCityId })
        .expect(200);

      expect(res1.body.items).toEqual(res2.body.items);
      expect(res1.body.count).toBe(res2.body.count);
    });
  });

  // ─── 5) Redis down -> search still works ──────────────────────
  describe('redis down fallback', () => {
    it('should return results even when Redis is unavailable', async () => {
      await createTripWithCity(
        bishkekCityId,
        oshCityId,
        'Бишкек',
        'Ош',
        42.8746,
        74.5698,
        40.5283,
        72.7985,
      );

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Бишкек', toCity: 'Ош' })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
    });
  });

  // ─── 6) Price range filter ────────────────────────────────────
  describe('price range filter', () => {
    it('should filter by price range', async () => {
      await ctx.prisma.trip.create({
        data: {
          driverId: DRIVER_ID,
          fromCity: 'Бишкек',
          toCity: 'Ош',
          fromCityId: bishkekCityId,
          toCityId: oshCityId,
          fromLat: 42.8746,
          fromLon: 74.5698,
          toLat: 40.5283,
          toLon: 72.7985,
          departAt: new Date('2026-06-15T08:00:00Z'),
          seatsTotal: 4,
          seatsAvailable: 4,
          priceKgs: 3000,
          status: 'ACTIVE',
        },
      });

      await ctx.prisma.trip.create({
        data: {
          driverId: DRIVER_ID,
          fromCity: 'Бишкек',
          toCity: 'Ош',
          fromCityId: bishkekCityId,
          toCityId: oshCityId,
          fromLat: 42.8746,
          fromLon: 74.5698,
          toLat: 40.5283,
          toLon: 72.7985,
          departAt: new Date('2026-06-15T09:00:00Z'),
          seatsTotal: 4,
          seatsAvailable: 4,
          priceKgs: 8000,
          status: 'ACTIVE',
        },
      });

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({
          fromCityId: bishkekCityId,
          priceMin: 2000,
          priceMax: 5000,
        })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].priceKgs).toBe(3000);
    });
  });

  // ─── 7) Validation: at least one location filter required ─────
  describe('validation', () => {
    it('should return 400 when no location filter provided', async () => {
      await request(ctx.app.getHttpServer()).get('/search').query({ minSeats: 1 }).expect(400);
    });
  });

  // ─── 8) Pagination ────────────────────────────────────────────
  describe('pagination', () => {
    it('should respect limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await ctx.prisma.trip.create({
          data: {
            driverId: DRIVER_ID,
            fromCity: 'Бишкек',
            toCity: 'Ош',
            fromCityId: bishkekCityId,
            toCityId: oshCityId,
            fromLat: 42.8746,
            fromLon: 74.5698,
            toLat: 40.5283,
            toLon: 72.7985,
            departAt: new Date(`2026-06-${15 + i}T08:00:00Z`),
            seatsTotal: 4,
            seatsAvailable: 4,
            priceKgs: 5000,
            status: 'ACTIVE',
          },
        });
      }

      const page1 = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCityId: bishkekCityId, limit: 2, offset: 0 })
        .expect(200);

      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.count).toBe(5);

      const page2 = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCityId: bishkekCityId, limit: 2, offset: 2 })
        .expect(200);

      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.items[0].tripId).not.toBe(page1.body.items[0].tripId);
    });
  });
});
