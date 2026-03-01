import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signEvent } from '../../src/shared/hmac';
import { EventEnvelope } from '../../src/shared/event-envelope';

const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

const PASSENGER_A = '00000000-0000-4000-a000-000000000002';

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(),
    eventType: 'booking.created',
    occurredAt: new Date().toISOString(),
    producer: 'trips-service',
    traceId: randomUUID(),
    payload: {
      bookingId: randomUUID(),
      tripId: randomUUID(),
      passengerId: PASSENGER_A,
      seats: 1,
      amountKgs: 5000,
      currency: 'KGS',
      departAt: '2025-06-15T08:00:00.000Z',
      createdAt: new Date().toISOString(),
    },
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

describe('Booking Saga E2E — payments-service', () => {
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
    ctx.fakePsp.setScenario('success');
  });

  // ─── 1) booking.created → hold placed (PSP success) ───

  it('should create intent and place hold on booking.created (PSP success)', async () => {
    const bookingId = randomUUID();
    const envelope = makeEnvelope({
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        amountKgs: 5000,
        currency: 'KGS',
        departAt: '2025-06-15T08:00:00.000Z',
        createdAt: new Date().toISOString(),
      },
    });
    const body = JSON.stringify(envelope);

    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res.body.status).toBe('processed');

    const intent = await ctx.prisma.paymentIntent.findUnique({
      where: { bookingId },
    });
    expect(intent).not.toBeNull();
    expect(intent!.status).toBe('HOLD_PLACED');
    expect(intent!.pspIntentId).toBeDefined();

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.intent.hold_placed' },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.traceId).toBe(envelope.traceId);

    const payload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(payload['bookingId']).toBe(bookingId);
    expect(payload['amountKgs']).toBe(5000);
  });

  // ─── 2) booking.created → hold failed (PSP failure) ───

  it('should create FAILED intent and emit payment.intent.failed on PSP failure', async () => {
    ctx.fakePsp.setScenario('failure');

    const bookingId = randomUUID();
    const envelope = makeEnvelope({
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        amountKgs: 5000,
        currency: 'KGS',
        departAt: '2025-06-15T08:00:00.000Z',
        createdAt: new Date().toISOString(),
      },
    });
    const body = JSON.stringify(envelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const intent = await ctx.prisma.paymentIntent.findUnique({
      where: { bookingId },
    });
    expect(intent).not.toBeNull();
    expect(intent!.status).toBe('FAILED');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.intent.failed' },
    });
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]!.payloadJson as Record<string, unknown>;
    expect(payload['bookingId']).toBe(bookingId);
    expect(payload['reason']).toBeDefined();
  });

  // ─── 3) booking.confirmed → capture ───

  it('should capture payment on booking.confirmed', async () => {
    const bookingId = randomUUID();
    const createdEnvelope = makeEnvelope({
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        amountKgs: 5000,
        currency: 'KGS',
        departAt: '2025-06-15T08:00:00.000Z',
        createdAt: new Date().toISOString(),
      },
    });
    const createdBody = JSON.stringify(createdEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(createdBody))
      .send(createdEnvelope)
      .expect(200);

    const confirmedEnvelope = makeEnvelope({
      eventId: randomUUID(),
      eventType: 'booking.confirmed',
      traceId: createdEnvelope.traceId,
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
      },
    });
    const confirmedBody = JSON.stringify(confirmedEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(confirmedBody))
      .send(confirmedEnvelope)
      .expect(200);

    const intent = await ctx.prisma.paymentIntent.findUnique({
      where: { bookingId },
    });
    expect(intent!.status).toBe('CAPTURED');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.captured' },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.traceId).toBe(createdEnvelope.traceId);
  });

  // ─── 4) booking.cancelled → cancel hold ───

  it('should cancel hold on booking.cancelled', async () => {
    const bookingId = randomUUID();
    const createdEnvelope = makeEnvelope({
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        amountKgs: 5000,
        currency: 'KGS',
        departAt: '2025-06-15T08:00:00.000Z',
        createdAt: new Date().toISOString(),
      },
    });
    const createdBody = JSON.stringify(createdEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(createdBody))
      .send(createdEnvelope)
      .expect(200);

    const cancelledEnvelope = makeEnvelope({
      eventId: randomUUID(),
      eventType: 'booking.cancelled',
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        reason: 'USER_CANCELLED',
      },
    });
    const cancelledBody = JSON.stringify(cancelledEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(cancelledBody))
      .send(cancelledEnvelope)
      .expect(200);

    const intent = await ctx.prisma.paymentIntent.findUnique({
      where: { bookingId },
    });
    expect(intent!.status).toBe('CANCELLED');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.cancelled' },
    });
    expect(outbox).toHaveLength(1);
  });

  // ─── 5) booking.expired → cancel hold ───

  it('should cancel hold on booking.expired', async () => {
    const bookingId = randomUUID();
    const createdEnvelope = makeEnvelope({
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        amountKgs: 5000,
        currency: 'KGS',
        departAt: '2025-06-15T08:00:00.000Z',
        createdAt: new Date().toISOString(),
      },
    });
    const createdBody = JSON.stringify(createdEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(createdBody))
      .send(createdEnvelope)
      .expect(200);

    const expiredEnvelope = makeEnvelope({
      eventId: randomUUID(),
      eventType: 'booking.expired',
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        reason: 'EXPIRED',
      },
    });
    const expiredBody = JSON.stringify(expiredEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(expiredBody))
      .send(expiredEnvelope)
      .expect(200);

    const intent = await ctx.prisma.paymentIntent.findUnique({
      where: { bookingId },
    });
    expect(intent!.status).toBe('CANCELLED');
  });

  // ─── 6) Idempotency: duplicate booking.confirmed ───

  it('should not double-capture on duplicate booking.confirmed', async () => {
    const bookingId = randomUUID();
    const createdEnvelope = makeEnvelope({
      payload: {
        bookingId,
        tripId: randomUUID(),
        passengerId: PASSENGER_A,
        seats: 1,
        amountKgs: 5000,
        currency: 'KGS',
        departAt: '2025-06-15T08:00:00.000Z',
        createdAt: new Date().toISOString(),
      },
    });
    const createdBody = JSON.stringify(createdEnvelope);
    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(createdBody))
      .send(createdEnvelope)
      .expect(200);

    const confirmedEnvelope = makeEnvelope({
      eventId: randomUUID(),
      eventType: 'booking.confirmed',
      payload: { bookingId, tripId: randomUUID(), passengerId: PASSENGER_A },
    });
    const confirmedBody = JSON.stringify(confirmedEnvelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(confirmedBody))
      .send(confirmedEnvelope)
      .expect(200);

    const res2 = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(confirmedBody))
      .send(confirmedEnvelope)
      .expect(200);

    expect(res2.body.status).toBe('duplicate');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.captured' },
    });
    expect(outbox).toHaveLength(1);
  });

  // ─── 7) traceId propagation ───

  it('should propagate traceId through booking.created → payment.intent.hold_placed', async () => {
    const traceId = 'saga-trace-propagation-test-12345678';
    const envelope = makeEnvelope({ traceId });
    const body = JSON.stringify(envelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.intent.hold_placed' },
    });
    expect(outbox[0]!.traceId).toBe(traceId);
  });
});
