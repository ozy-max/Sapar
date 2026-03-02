import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signEvent } from '../../src/shared/hmac';
import { EventEnvelope } from '../../src/shared/event-envelope';
import { BookingExpirationWorker } from '../../src/workers/booking-expiration.worker';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

const DRIVER_ID = '00000000-0000-4000-a000-000000000001';
const PASSENGER_A = '00000000-0000-4000-a000-000000000002';

function auth(userId: string): string {
  const t = jwt.sign({ sub: userId, email: `${userId}@test.com` }, JWT_SECRET, { expiresIn: 3600 });
  return `Bearer ${t}`;
}

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(),
    eventType: 'payment.intent.hold_placed',
    occurredAt: new Date().toISOString(),
    producer: 'payments-service',
    traceId: randomUUID(),
    payload: {},
    version: 1,
    ...overrides,
  };
}

function signedHeaders(body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signEvent(body, timestamp, HMAC_SECRET);
  return {
    'Content-Type': 'application/json',
    'X-Event-Signature': signature,
    'X-Event-Timestamp': String(timestamp),
  };
}

const tripBody = {
  fromCity: 'Алматы',
  toCity: 'Астана',
  departAt: '2025-06-15T08:00:00.000Z',
  seatsTotal: 3,
  priceKgs: 5000,
};

async function createTripAndBook(
  ctx: TestContext,
): Promise<{ tripId: string; bookingId: string; traceId: string }> {
  const created = await request(ctx.app.getHttpServer())
    .post('/')
    .set('Authorization', auth(DRIVER_ID))
    .send(tripBody)
    .expect(201);

  const tripId = created.body.tripId;
  const traceId = randomUUID();

  const bookRes = await request(ctx.app.getHttpServer())
    .post(`/${tripId}/book`)
    .set('Authorization', auth(PASSENGER_A))
    .set('x-request-id', traceId)
    .send({ seats: 1 })
    .expect(201);

  return { tripId, bookingId: bookRes.body.bookingId, traceId };
}

describe('Booking Saga E2E — trips-service', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    process.env['EVENTS_HMAC_SECRET'] = HMAC_SECRET;
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  // ─── 1) Booking creates with PENDING_PAYMENT + booking.created in outbox ───

  it('should create booking with PENDING_PAYMENT and emit booking.created', async () => {
    const { bookingId } = await createTripAndBook(ctx);

    expect(bookingId).toBeDefined();

    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('PENDING_PAYMENT');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.created' },
    });
    expect(outbox).toHaveLength(1);

    const payload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(payload['bookingId']).toBe(bookingId);
    expect(payload['amountKgs']).toBe(5000);
    expect(payload['currency']).toBe('KGS');
    expect(payload['departAt']).toBeDefined();
    expect(payload['createdAt']).toBeDefined();
  });

  // ─── 2) Hold placed → booking CONFIRMED + booking.confirmed in outbox ───

  it('should confirm booking on payment.intent.hold_placed event', async () => {
    const { tripId, bookingId, traceId } = await createTripAndBook(ctx);

    const envelope = makeEnvelope({
      eventType: 'payment.intent.hold_placed',
      traceId,
      payload: {
        paymentIntentId: randomUUID(),
        bookingId,
        passengerId: PASSENGER_A,
        amountKgs: 5000,
        status: 'HOLD_PLACED',
        occurredAt: new Date().toISOString(),
      },
    });
    const body = JSON.stringify(envelope);

    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res.body.status).toBe('processed');

    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('CONFIRMED');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.confirmed' },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.traceId).toBe(traceId);

    const confirmedPayload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(confirmedPayload['bookingId']).toBe(bookingId);
    expect(confirmedPayload['tripId']).toBe(tripId);
    expect(confirmedPayload['passengerId']).toBe(PASSENGER_A);
  });

  // ─── 3) Hold failed → booking CANCELLED + seats released ───

  it('should cancel booking and release seats on payment.intent.failed', async () => {
    const { tripId, bookingId, traceId } = await createTripAndBook(ctx);

    const envelope = makeEnvelope({
      eventType: 'payment.intent.failed',
      traceId,
      payload: {
        paymentIntentId: randomUUID(),
        bookingId,
        passengerId: PASSENGER_A,
        reason: 'PSP unavailable',
      },
    });
    const body = JSON.stringify(envelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('CANCELLED');

    const trip = await ctx.prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.seatsAvailable).toBe(3);

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.cancelled' },
    });
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(payload['reason']).toBe('PAYMENT_FAILED');
  });

  // ─── 4) Expiration: PENDING_PAYMENT older than TTL → EXPIRED ───

  it('should expire stale PENDING_PAYMENT bookings', async () => {
    const { tripId, bookingId } = await createTripAndBook(ctx);

    await ctx.prisma.booking.update({
      where: { id: bookingId },
      data: { createdAt: new Date(Date.now() - 1000 * 1000) },
    });

    const worker = ctx.app.get(BookingExpirationWorker);
    const origTtl = process.env['BOOKING_TTL_SEC'];
    process.env['BOOKING_TTL_SEC'] = '1';
    const { resetEnvCache } = await import('../../src/config/env');
    resetEnvCache();

    await worker.tick();

    process.env['BOOKING_TTL_SEC'] = origTtl ?? '900';
    resetEnvCache();

    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('EXPIRED');

    const trip = await ctx.prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.seatsAvailable).toBe(3);

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.expired' },
    });
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(payload['reason']).toBe('EXPIRED');
  });

  // ─── 5) Cancel PENDING_PAYMENT booking ───

  it('should cancel a PENDING_PAYMENT booking with reason USER_CANCELLED', async () => {
    const { tripId, bookingId } = await createTripAndBook(ctx);

    const cancelRes = await request(ctx.app.getHttpServer())
      .post(`/bookings/${bookingId}/cancel`)
      .set('Authorization', auth(PASSENGER_A))
      .expect(200);

    expect(cancelRes.body.status).toBe('CANCELLED');

    const trip = await ctx.prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.seatsAvailable).toBe(3);

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.cancelled' },
    });
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(payload['reason']).toBe('USER_CANCELLED');
  });

  // ─── 6) Cancel CONFIRMED booking ───

  it('should cancel a CONFIRMED booking', async () => {
    const { tripId, bookingId, traceId } = await createTripAndBook(ctx);

    const holdEnvelope = makeEnvelope({
      eventType: 'payment.intent.hold_placed',
      traceId,
      payload: {
        paymentIntentId: randomUUID(),
        bookingId,
        passengerId: PASSENGER_A,
        amountKgs: 5000,
        status: 'HOLD_PLACED',
        occurredAt: new Date().toISOString(),
      },
    });
    const holdBody = JSON.stringify(holdEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(holdBody))
      .send(holdEnvelope)
      .expect(200);

    const before = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(before!.status).toBe('CONFIRMED');

    await request(ctx.app.getHttpServer())
      .post(`/bookings/${bookingId}/cancel`)
      .set('Authorization', auth(PASSENGER_A))
      .expect(200);

    const after = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(after!.status).toBe('CANCELLED');

    const trip = await ctx.prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.seatsAvailable).toBe(3);
  });

  // ─── 7) Idempotency: duplicate hold_placed does not re-confirm ───

  it('should return duplicate for repeated payment.intent.hold_placed', async () => {
    const { bookingId, traceId } = await createTripAndBook(ctx);

    const envelope = makeEnvelope({
      eventType: 'payment.intent.hold_placed',
      traceId,
      payload: {
        paymentIntentId: randomUUID(),
        bookingId,
        passengerId: PASSENGER_A,
        amountKgs: 5000,
        status: 'HOLD_PLACED',
        occurredAt: new Date().toISOString(),
      },
    });
    const body = JSON.stringify(envelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const res2 = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res2.body.status).toBe('duplicate');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.confirmed' },
    });
    expect(outbox).toHaveLength(1);
  });

  // ─── 8) traceId propagation from booking.created chain ───

  it('should propagate traceId from x-request-id through event chain', async () => {
    const { traceId } = await createTripAndBook(ctx);

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'booking.created' },
    });
    expect(outbox[0]!.traceId).toBe(traceId);
  });

  // ─── 9) HMAC rejection ───

  it('should reject events with invalid HMAC', async () => {
    const envelope = makeEnvelope();
    const timestamp = Math.floor(Date.now() / 1000);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set({
        'Content-Type': 'application/json',
        'X-Event-Signature': 'invalid-sig',
        'X-Event-Timestamp': String(timestamp),
      })
      .send(envelope)
      .expect(401);
  });

  // ─── 10) Ignore unknown event types ───

  it('should ignore unknown event types', async () => {
    const envelope = makeEnvelope({ eventType: 'unknown.event' });
    const body = JSON.stringify(envelope);

    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res.body.status).toBe('ignored');
  });

  // ─── 11) Re-booking after cancellation ───

  it('should allow re-booking after cancellation', async () => {
    const { tripId, bookingId } = await createTripAndBook(ctx);

    await request(ctx.app.getHttpServer())
      .post(`/bookings/${bookingId}/cancel`)
      .set('Authorization', auth(PASSENGER_A))
      .expect(200);

    const cancelled = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(cancelled!.status).toBe('CANCELLED');

    const rebookRes = await request(ctx.app.getHttpServer())
      .post(`/${tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .set('x-request-id', randomUUID())
      .send({ seats: 1 })
      .expect(201);

    expect(rebookRes.body.bookingId).toBeDefined();
    expect(rebookRes.body.bookingId).not.toBe(bookingId);
  });

  // ─── 12) Reject parallel active bookings ───

  it('should reject parallel active bookings with 409', async () => {
    const { tripId } = await createTripAndBook(ctx);

    const res = await request(ctx.app.getHttpServer())
      .post(`/${tripId}/book`)
      .set('Authorization', auth(PASSENGER_A))
      .set('x-request-id', randomUUID())
      .send({ seats: 1 })
      .expect(409);

    expect(res.body.code).toBe('BOOKING_EXISTS');
  });
});
