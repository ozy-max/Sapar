import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signEvent } from '../../src/shared/hmac';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

function makeToken(sub: string, roles: string[] = []): string {
  return jwt.sign({ sub, email: `${sub}@test.com`, roles }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

function sendEvent(
  server: ReturnType<typeof request>,
  envelope: Record<string, unknown>,
): request.Test {
  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signEvent(body, timestamp, HMAC_SECRET);

  return server
    .post('/internal/events')
    .set('Content-Type', 'application/json')
    .set('X-Event-Signature', signature)
    .set('X-Event-Timestamp', String(timestamp))
    .send(body);
}

describe('Profiles Service E2E', () => {
  let ctx: TestContext;

  const driverId = randomUUID();
  const passengerId = randomUUID();
  const tripId = randomUUID();
  const bookingId = randomUUID();

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  function server(): ReturnType<typeof request> {
    return request(ctx.app.getHttpServer());
  }

  describe('Health', () => {
    it('GET /health returns ok', async () => {
      const res = await server().get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /ready returns ok', async () => {
      const res = await server().get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('Profiles CRUD', () => {
    it('PUT /me/profile creates a new profile (upsert)', async () => {
      const token = makeToken(passengerId);
      const res = await server()
        .put('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Алмат Касымов', bio: 'Тестовый профиль', city: 'Бишкек' });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(passengerId);
      expect(res.body.displayName).toBe('Алмат Касымов');
      expect(res.body.city).toBe('Бишкек');
    });

    it('PUT /me/profile updates existing profile', async () => {
      const token = makeToken(passengerId);
      await server()
        .put('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Алмат' });

      const res = await server()
        .put('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Алмат Обновлённый', city: 'Ош' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Алмат Обновлённый');
      expect(res.body.city).toBe('Ош');
    });

    it('GET /profiles/:userId returns profile with rating aggregate', async () => {
      const token = makeToken(passengerId);
      await server()
        .put('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Алмат', city: 'Бишкек' });

      const res = await server().get(`/profiles/${passengerId}`);
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(passengerId);
      expect(res.body.ratingAvg).toBe(0);
      expect(res.body.ratingCount).toBe(0);
    });

    it('GET /profiles/:userId returns 404 for missing profile', async () => {
      const res = await server().get(`/profiles/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PROFILE_NOT_FOUND');
    });
  });

  describe('Rating eligibility via events', () => {
    it('processes trip.completed event and creates eligibility', async () => {
      const eventId = randomUUID();
      const res = await sendEvent(server(), {
        eventId,
        eventType: 'trip.completed',
        occurredAt: new Date().toISOString(),
        producer: 'trips-service',
        traceId: randomUUID(),
        version: 1,
        payload: {
          tripId,
          driverId,
          completedAt: new Date().toISOString(),
          confirmedBookings: [{ bookingId, passengerId }],
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processed');

      const eligibility = await ctx.prisma.ratingEligibility.findFirst({
        where: { tripId },
      });
      expect(eligibility).toBeTruthy();
      expect(eligibility!.driverId).toBe(driverId);
      expect(eligibility!.passengerId).toBe(passengerId);
    });

    it('deduplicates consumed events', async () => {
      const eventId = randomUUID();
      const envelope = {
        eventId,
        eventType: 'trip.completed',
        occurredAt: new Date().toISOString(),
        producer: 'trips-service',
        traceId: randomUUID(),
        version: 1,
        payload: {
          tripId,
          driverId,
          completedAt: new Date().toISOString(),
          confirmedBookings: [{ bookingId, passengerId }],
        },
      };

      await sendEvent(server(), envelope);
      const res = await sendEvent(server(), envelope);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('duplicate');
    });
  });

  describe('Ratings', () => {
    async function seedEligibility(completedAt?: Date): Promise<void> {
      await ctx.prisma.ratingEligibility.create({
        data: {
          tripId,
          bookingId,
          driverId,
          passengerId,
          completedAt: completedAt ?? new Date(),
        },
      });
    }

    it('cannot rate if not a participant', async () => {
      await seedEligibility();
      const outsider = randomUUID();
      const token = makeToken(outsider);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 5 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NOT_ELIGIBLE');
    });

    it('cannot rate before trip completed (no eligibility)', async () => {
      const token = makeToken(passengerId);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId: randomUUID(), score: 5 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NOT_ELIGIBLE');
    });

    it('can rate after completion within window (passenger rates driver)', async () => {
      await seedEligibility();

      await ctx.prisma.userProfile.create({
        data: { userId: driverId, displayName: 'Водитель' },
      });

      const token = makeToken(passengerId);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 5, comment: 'Отличный водитель!' });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe('PASSENGER_RATES_DRIVER');
      expect(res.body.score).toBe(5);
      expect(res.body.comment).toBe('Отличный водитель!');
    });

    it('can rate after completion (driver rates passenger)', async () => {
      await seedEligibility();

      const token = makeToken(driverId);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 4 });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe('DRIVER_RATES_PASSENGER');
      expect(res.body.score).toBe(4);
    });

    it('duplicate rating blocked by unique constraint -> 409', async () => {
      await seedEligibility();

      const token = makeToken(passengerId);
      await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 5 });

      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 4 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_RATING');
    });

    it('rating window expired -> 409', async () => {
      const expiredDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      await seedEligibility(expiredDate);

      const token = makeToken(passengerId);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 5 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RATING_WINDOW_EXPIRED');
    });

    it('comment length validation', async () => {
      await seedEligibility();

      const token = makeToken(passengerId);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 5, comment: 'x'.repeat(501) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('score out of range validation', async () => {
      await seedEligibility();

      const token = makeToken(passengerId);
      const res = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 6 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('updates rating aggregate after creating a rating', async () => {
      await seedEligibility();

      const token = makeToken(passengerId);
      await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 4 });

      const agg = await ctx.prisma.ratingAggregate.findUnique({
        where: { userId: driverId },
      });
      expect(agg).toBeTruthy();
      expect(agg!.ratingCount).toBe(1);
      expect(agg!.ratingAvg).toBe(4);
    });

    it('GET /profiles/:userId/ratings returns paginated ratings', async () => {
      await seedEligibility();

      const token = makeToken(passengerId);
      await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 5, comment: 'Класс' });

      const res = await server().get(`/profiles/${driverId}/ratings?limit=10&offset=0`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].score).toBe(5);
      expect(res.body.total).toBe(1);
    });
  });

  describe('Admin', () => {
    it('DELETE /admin/ratings/:id requires ADMIN role', async () => {
      const token = makeToken(passengerId, []);
      const res = await server()
        .delete(`/admin/ratings/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('DELETE /admin/ratings/:id soft-deletes rating with ADMIN role', async () => {
      await ctx.prisma.ratingEligibility.create({
        data: { tripId, bookingId, driverId, passengerId, completedAt: new Date() },
      });

      const token = makeToken(passengerId);
      const createRes = await server()
        .post('/ratings')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, score: 3 });

      const ratingId = createRes.body.id;

      const adminToken = makeToken(randomUUID(), ['ADMIN']);
      const res = await server()
        .delete(`/admin/ratings/${ratingId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DELETED');

      const deleted = await ctx.prisma.rating.findUnique({ where: { id: ratingId } });
      expect(deleted!.status).toBe('DELETED');
    });
  });
});
