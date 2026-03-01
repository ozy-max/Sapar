import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { OutboxWorker } from '../../src/workers/outbox.worker';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';
const DRIVER_ID = '00000000-0000-4000-a000-000000000001';
const PASSENGER_A = '00000000-0000-4000-a000-000000000002';
const PASSENGER_B = '00000000-0000-4000-a000-000000000003';

function auth(userId: string): string {
  const token = jwt.sign({ sub: userId, email: `${userId}@test.com` }, JWT_SECRET, { expiresIn: 3600 });
  return `Bearer ${token}`;
}

describe('Outbox E2E — trips-service', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    process.env['EVENTS_HMAC_SECRET'] = HMAC_SECRET;
    process.env['OUTBOX_TARGETS'] = '';
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  const tripBody = {
    fromCity: 'Бишкек',
    toCity: 'Ош',
    departAt: '2026-06-15T08:00:00.000Z',
    seatsTotal: 3,
    priceKgs: 2000,
  };

  // ─── 1) Outbox atomicity: booking creates outbox event in same transaction ──
  it('should create outbox event atomically with booking', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/')
      .set('Authorization', auth(DRIVER_ID))
      .send(tripBody)
      .expect(201);

    const tripId = created.body.tripId;
    const traceId = 'trace-outbox-atomicity-test';

    await request(ctx.app.getHttpServer())
      .post(`/${tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .set('x-request-id', traceId)
      .send({ seats: 1 })
      .expect(201);

    const outboxEvents = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.created' },
    });

    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]!.status).toBe('PENDING');
    expect(outboxEvents[0]!.traceId).toBe(traceId);
    expect(outboxEvents[0]!.tryCount).toBe(0);

    const payload = outboxEvents[0]!.payloadJson as Record<string, unknown>;
    expect(payload['tripId']).toBe(tripId);
    expect(payload['passengerId']).toBe(PASSENGER_A);
    expect(payload['seats']).toBe(1);
    expect(payload['amountKgs']).toBe(2000);
  });

  // ─── 2) Cancel booking creates booking.cancelled outbox event ───
  it('should create booking.cancelled outbox event on cancel', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/')
      .set('Authorization', auth(DRIVER_ID))
      .send(tripBody)
      .expect(201);

    const bookRes = await request(ctx.app.getHttpServer())
      .post(`/${created.body.tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .send({ seats: 1 })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post(`/bookings/${bookRes.body.bookingId}/cancel`)
      .set('Authorization', auth(PASSENGER_A))
      .set('x-request-id', 'trace-cancel')
      .expect(200);

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.cancelled' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.traceId).toBe('trace-cancel');
  });

  // ─── 3) Cancel trip creates trip.cancelled outbox event ───
  it('should create trip.cancelled outbox event on trip cancel', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/')
      .set('Authorization', auth(DRIVER_ID))
      .send(tripBody)
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post(`/${created.body.tripId}/cancel`)
      .set('Authorization', auth(DRIVER_ID))
      .set('x-request-id', 'trace-trip-cancel')
      .expect(200);

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'trip.cancelled' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.traceId).toBe('trace-trip-cancel');
  });

  // ─── 4) Cancel trip with 2 bookings → booking.cancelled for each ───
  it('should emit booking.cancelled for every active booking when trip is cancelled', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/')
      .set('Authorization', auth(DRIVER_ID))
      .send(tripBody)
      .expect(201);

    const tripId = created.body.tripId;

    const bookA = await request(ctx.app.getHttpServer())
      .post(`/${tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .send({ seats: 1 })
      .expect(201);

    const bookB = await request(ctx.app.getHttpServer())
      .post(`/${tripId}/book`)
      .set('Authorization', auth(PASSENGER_B))
      .send({ seats: 1 })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post(`/${tripId}/cancel`)
      .set('Authorization', auth(DRIVER_ID))
      .expect(200);

    const cancelledEvents = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.cancelled' },
      orderBy: { occurredAt: 'asc' },
    });

    expect(cancelledEvents).toHaveLength(2);

    const payloads = cancelledEvents.map(
      (e) => e.payloadJson as Record<string, unknown>,
    );
    const bookingIds = payloads.map((p) => p['bookingId']).sort();
    expect(bookingIds).toEqual(
      [bookA.body.bookingId, bookB.body.bookingId].sort(),
    );

    for (const payload of payloads) {
      expect(payload['tripId']).toBe(tripId);
      expect(payload['reason']).toBe('TRIP_CANCELLED');
    }

    const tripCancelledEvents = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'trip.cancelled' },
    });
    expect(tripCancelledEvents).toHaveLength(1);
  });

  // ─── 5) Worker marks SENT when no target configured ───
  it('should mark event as SENT when no delivery target configured', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/')
      .set('Authorization', auth(DRIVER_ID))
      .send(tripBody)
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post(`/${created.body.tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .send({ seats: 1 })
      .expect(201);

    const worker = ctx.app.get(OutboxWorker);
    await worker.tick();

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.created' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('SENT');
  });

  // ─── 6) traceId propagation ───
  it('should preserve traceId from x-request-id in outbox events', async () => {
    const customTraceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    const created = await request(ctx.app.getHttpServer())
      .post('/')
      .set('Authorization', auth(DRIVER_ID))
      .send(tripBody)
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post(`/${created.body.tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .set('x-request-id', customTraceId)
      .send({ seats: 1 })
      .expect(201);

    const events = await ctx.prisma.outboxEvent.findMany();
    expect(events[0]!.traceId).toBe(customTraceId);
  });
});
