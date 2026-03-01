import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signEvent } from '../../src/shared/hmac';
import { EventEnvelope } from '../../src/shared/event-envelope';
import { OutboxWorker } from '../../src/workers/outbox.worker';

const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

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
      passengerId: randomUUID(),
      seats: 1,
      priceKgs: 2000,
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

describe('Outbox + Consumer E2E — payments-service', () => {
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

  // ─── 1) Consumer processes booking.created event ───
  it('should consume booking.created and create payment intent', async () => {
    const envelope = makeEnvelope();
    const body = JSON.stringify(envelope);

    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res.body.status).toBe('processed');

    const consumed = await ctx.prisma.consumedEvent.findUnique({
      where: { eventId: envelope.eventId },
    });
    expect(consumed).not.toBeNull();
    expect(consumed!.eventType).toBe('booking.created');
    expect(consumed!.producer).toBe('trips-service');
    expect(consumed!.traceId).toBe(envelope.traceId);

    const intents = await ctx.prisma.paymentIntent.findMany();
    expect(intents).toHaveLength(1);
    expect(intents[0]!.status).toBe('HOLD_PLACED');

    const outboxEvents = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.intent.hold_placed' },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]!.traceId).toBe(envelope.traceId);
  });

  // ─── 2) Consumer idempotency: same event twice → second is no-op ───
  it('should return duplicate for repeated event', async () => {
    const envelope = makeEnvelope();
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

    const intents = await ctx.prisma.paymentIntent.findMany();
    expect(intents).toHaveLength(1);
  });

  // ─── 3) HMAC verification rejects invalid signature ───
  it('should reject event with invalid HMAC signature', async () => {
    const envelope = makeEnvelope();
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set({
        'Content-Type': 'application/json',
        'X-Event-Signature': 'invalid-signature',
        'X-Event-Timestamp': String(timestamp),
      })
      .send(envelope)
      .expect(401);
  });

  // ─── 4) HMAC verification rejects missing headers ───
  it('should reject event without HMAC headers', async () => {
    const envelope = makeEnvelope();

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set('Content-Type', 'application/json')
      .send(envelope)
      .expect(401);
  });

  // ─── 5) Unknown event type is ignored ───
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

  // ─── 6) Outbox worker marks events as SENT when no target ───
  it('should mark outbox events as SENT when no target configured', async () => {
    const envelope = makeEnvelope();
    const body = JSON.stringify(envelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const worker = ctx.app.get(OutboxWorker);
    await worker.tick();

    const outboxEvents = await ctx.prisma.outboxEvent.findMany({
      where: { status: 'SENT' },
    });
    expect(outboxEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ─── 7) traceId propagation through event chain ───
  it('should propagate traceId from incoming event to outbox event', async () => {
    const traceId = 'propagation-test-trace-id-12345678';
    const envelope = makeEnvelope({ traceId });
    const body = JSON.stringify(envelope);

    await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const outboxEvents = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.intent.hold_placed' },
    });
    expect(outboxEvents[0]!.traceId).toBe(traceId);
  });
});
