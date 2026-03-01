import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';

const DRIVER_ID = '00000000-0000-4000-a000-000000000001';
const PASSENGER_A = '00000000-0000-4000-a000-000000000002';
const PASSENGER_B = '00000000-0000-4000-a000-000000000003';

function token(userId: string): string {
  return jwt.sign({ sub: userId, email: `${userId}@test.com` }, JWT_SECRET, { expiresIn: 3600 });
}

function auth(userId: string): string {
  return `Bearer ${token(userId)}`;
}

describe('Trips Service E2E', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  const tripBody = {
    fromCity: 'Алматы',
    toCity: 'Астана',
    departAt: '2025-06-15T08:00:00.000Z',
    seatsTotal: 3,
    priceKgs: 5000,
  };

  // ─── 1) create trip (authorized driver) ────────────────────────────

  describe('POST / (create trip)', () => {
    it('should create a trip and return 201', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      expect(res.body.tripId).toBeDefined();
      expect(res.body.driverId).toBe(DRIVER_ID);
      expect(res.body.fromCity).toBe('Алматы');
      expect(res.body.seatsTotal).toBe(3);
      expect(res.body.seatsAvailable).toBe(3);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('should return 401 without auth', async () => {
      await request(ctx.app.getHttpServer()).post('/').send(tripBody).expect(401);
    });

    it('should return 400 for invalid body', async () => {
      await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send({ fromCity: '' })
        .expect(400);
    });
  });

  // ─── 2) search returns trip ────────────────────────────────────────

  describe('GET /search', () => {
    it('should return the created trip', async () => {
      await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Алматы', toCity: 'Астана' })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].fromCity).toBe('Алматы');
      expect(res.body.items[0].toCity).toBe('Астана');
    });

    it('should not return cancelled trips', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      await request(ctx.app.getHttpServer())
        .post(`/${created.body.tripId}/cancel`)
        .set('Authorization', auth(DRIVER_ID))
        .expect(200);

      const res = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Алматы', toCity: 'Астана' })
        .expect(200);

      expect(res.body.items).toHaveLength(0);
    });
  });

  // ─── 3) book seat success; seatsAvailable decreases ────────────────

  describe('POST /:tripId/book', () => {
    it('should book a seat and decrease seatsAvailable', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      const tripId = created.body.tripId;

      const bookRes = await request(ctx.app.getHttpServer())
        .post(`/${tripId}/book`)
        .set('Authorization', auth(PASSENGER_A))
        .send({ seats: 1 })
        .expect(201);

      expect(bookRes.body.bookingId).toBeDefined();
      expect(bookRes.body.tripId).toBe(tripId);
      expect(bookRes.body.status).toBe('ACTIVE');

      const searchRes = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Алматы', toCity: 'Астана' })
        .expect(200);

      expect(searchRes.body.items[0].seatsAvailable).toBe(2);
    });
  });

  // ─── 4) race test: two concurrent bookings for last seat ───────────

  describe('concurrent booking race', () => {
    it('should allow exactly one booking when only 1 seat left', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send({ ...tripBody, seatsTotal: 1 })
        .expect(201);

      const tripId = created.body.tripId;

      const [resA, resB] = await Promise.all([
        request(ctx.app.getHttpServer())
          .post(`/${tripId}/book`)
          .set('Authorization', auth(PASSENGER_A))
          .send({ seats: 1 }),
        request(ctx.app.getHttpServer())
          .post(`/${tripId}/book`)
          .set('Authorization', auth(PASSENGER_B))
          .send({ seats: 1 }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const success = resA.status === 201 ? resA : resB;
      const failure = resA.status === 409 ? resA : resB;

      expect(success.body.bookingId).toBeDefined();
      expect(failure.body.code).toBe('NOT_ENOUGH_SEATS');
    });
  });

  // ─── 5) cancel booking restores seatsAvailable ─────────────────────

  describe('POST /bookings/:bookingId/cancel', () => {
    it('should cancel booking and restore seatsAvailable', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      const tripId = created.body.tripId;

      const bookRes = await request(ctx.app.getHttpServer())
        .post(`/${tripId}/book`)
        .set('Authorization', auth(PASSENGER_A))
        .send({ seats: 1 })
        .expect(201);

      const cancelRes = await request(ctx.app.getHttpServer())
        .post(`/bookings/${bookRes.body.bookingId}/cancel`)
        .set('Authorization', auth(PASSENGER_A))
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      const searchRes = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Алматы', toCity: 'Астана' })
        .expect(200);

      expect(searchRes.body.items[0].seatsAvailable).toBe(3);
    });
  });

  // ─── 6) cancel trip forbids further booking ────────────────────────

  describe('cancel trip -> no further bookings', () => {
    it('should forbid booking after trip cancellation', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      const tripId = created.body.tripId;

      await request(ctx.app.getHttpServer())
        .post(`/${tripId}/cancel`)
        .set('Authorization', auth(DRIVER_ID))
        .expect(200);

      const bookRes = await request(ctx.app.getHttpServer())
        .post(`/${tripId}/book`)
        .set('Authorization', auth(PASSENGER_A))
        .send({ seats: 1 })
        .expect(409);

      expect(bookRes.body.code).toBe('TRIP_NOT_ACTIVE');
    });
  });

  // ─── 7) traceId equals x-request-id on error responses ────────────

  describe('traceId handling', () => {
    it('should set traceId from x-request-id on error', async () => {
      const customId = '12345678-aaaa-bbbb-cccc-dddddddddddd';
      const missingTripId = '00000000-0000-4000-a000-ffffffffffff';

      const res = await request(ctx.app.getHttpServer())
        .post(`/${missingTripId}/book`)
        .set('Authorization', auth(PASSENGER_A))
        .set('x-request-id', customId)
        .send({ seats: 1 })
        .expect(404);

      expect(res.body.traceId).toBe(customId);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  // ─── 8) idempotency ───────────────────────────────────────────────

  describe('idempotency key', () => {
    it('should return the same booking on retry with same Idempotency-Key', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/')
        .set('Authorization', auth(DRIVER_ID))
        .send(tripBody)
        .expect(201);

      const tripId = created.body.tripId;
      const idempotencyKey = 'idem-key-unique-123';

      const first = await request(ctx.app.getHttpServer())
        .post(`/${tripId}/book`)
        .set('Authorization', auth(PASSENGER_A))
        .set('Idempotency-Key', idempotencyKey)
        .send({ seats: 1 })
        .expect(201);

      const second = await request(ctx.app.getHttpServer())
        .post(`/${tripId}/book`)
        .set('Authorization', auth(PASSENGER_A))
        .set('Idempotency-Key', idempotencyKey)
        .send({ seats: 1 })
        .expect(201);

      expect(first.body.bookingId).toBe(second.body.bookingId);

      const searchRes = await request(ctx.app.getHttpServer())
        .get('/search')
        .query({ fromCity: 'Алматы', toCity: 'Астана' })
        .expect(200);

      expect(searchRes.body.items[0].seatsAvailable).toBe(2);
    });
  });
});
