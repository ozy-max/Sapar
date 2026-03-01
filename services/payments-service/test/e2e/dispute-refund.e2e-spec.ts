import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import { signEvent } from '../../src/shared/hmac';
import { randomUUID } from 'node:crypto';

const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

function signedEvent(envelope: Record<string, unknown>): {
  body: string;
  headers: Record<string, string>;
} {
  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signEvent(body, timestamp, HMAC_SECRET);
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Signature': signature,
      'X-Event-Timestamp': String(timestamp),
    },
  };
}

describe('Dispute Refund (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    resetEnvCache();
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanDatabase(ctx.prisma);
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    ctx.fakePsp.setScenario('success');
  });

  async function seedCapturedPayment(bookingId: string, amountKgs: number): Promise<string> {
    const intent = await ctx.prisma.paymentIntent.create({
      data: {
        bookingId,
        payerId: '00000000-0000-4000-a000-000000000001',
        amountKgs,
        status: 'CAPTURED',
        pspIntentId: `fake_hold_${randomUUID()}`,
      },
    });
    return intent.id;
  }

  it('should refund payment on dispute.resolved REFUND event', async () => {
    const bookingId = randomUUID();
    const intentId = await seedCapturedPayment(bookingId, 1000);

    const envelope = {
      eventId: randomUUID(),
      eventType: 'dispute.resolved',
      occurredAt: new Date().toISOString(),
      producer: 'admin-service',
      traceId: 'trace-refund-1',
      payload: {
        disputeId: randomUUID(),
        bookingId,
        resolution: 'REFUND',
      },
      version: 1,
    };

    const signed = signedEvent(envelope);
    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signed.headers)
      .send(JSON.parse(signed.body));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const intent = await ctx.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    expect(intent?.status).toBe('REFUNDED');

    const outbox = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'payment.refunded' },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle PARTIAL refund', async () => {
    const bookingId = randomUUID();
    const intentId = await seedCapturedPayment(bookingId, 1000);

    const envelope = {
      eventId: randomUUID(),
      eventType: 'dispute.resolved',
      occurredAt: new Date().toISOString(),
      producer: 'admin-service',
      traceId: 'trace-partial-1',
      payload: {
        disputeId: randomUUID(),
        bookingId,
        resolution: 'PARTIAL',
        refundAmountKgs: 500,
      },
      version: 1,
    };

    const signed = signedEvent(envelope);
    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signed.headers)
      .send(JSON.parse(signed.body));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const intent = await ctx.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    expect(intent?.status).toBe('REFUNDED');

    const events = await ctx.prisma.paymentEvent.findMany({
      where: { paymentIntentId: intentId, type: 'REFUNDED' },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payloadJson as Record<string, unknown>;
    expect(payload['refundAmountKgs']).toBe(500);
  });

  it('should skip NO_REFUND resolution', async () => {
    const bookingId = randomUUID();
    await seedCapturedPayment(bookingId, 1000);

    const envelope = {
      eventId: randomUUID(),
      eventType: 'dispute.resolved',
      occurredAt: new Date().toISOString(),
      producer: 'admin-service',
      traceId: 'trace-norefund-1',
      payload: {
        disputeId: randomUUID(),
        bookingId,
        resolution: 'NO_REFUND',
      },
      version: 1,
    };

    const signed = signedEvent(envelope);
    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signed.headers)
      .send(JSON.parse(signed.body));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const intents = await ctx.prisma.paymentIntent.findMany({
      where: { bookingId },
    });
    expect(intents[0].status).toBe('CAPTURED');
  });

  it('should be idempotent — duplicate event is no-op', async () => {
    const bookingId = randomUUID();
    await seedCapturedPayment(bookingId, 1000);

    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'dispute.resolved',
      occurredAt: new Date().toISOString(),
      producer: 'admin-service',
      traceId: 'trace-idempotent',
      payload: {
        disputeId: randomUUID(),
        bookingId,
        resolution: 'REFUND',
      },
      version: 1,
    };

    const signed1 = signedEvent(envelope);
    const res1 = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signed1.headers)
      .send(JSON.parse(signed1.body));
    expect(res1.body.status).toBe('processed');

    const signed2 = signedEvent(envelope);
    const res2 = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signed2.headers)
      .send(JSON.parse(signed2.body));
    expect(res2.body.status).toBe('duplicate');
  });

  it('should skip refund if payment not in CAPTURED state', async () => {
    const bookingId = randomUUID();
    await ctx.prisma.paymentIntent.create({
      data: {
        bookingId,
        payerId: '00000000-0000-4000-a000-000000000001',
        amountKgs: 1000,
        status: 'CANCELLED',
        pspIntentId: `fake_${randomUUID()}`,
      },
    });

    const envelope = {
      eventId: randomUUID(),
      eventType: 'dispute.resolved',
      occurredAt: new Date().toISOString(),
      producer: 'admin-service',
      traceId: 'trace-skip-cancelled',
      payload: {
        disputeId: randomUUID(),
        bookingId,
        resolution: 'REFUND',
      },
      version: 1,
    };

    const signed = signedEvent(envelope);
    const res = await request(ctx.app.getHttpServer())
      .post('/internal/events')
      .set(signed.headers)
      .send(JSON.parse(signed.body));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const intent = await ctx.prisma.paymentIntent.findFirst({ where: { bookingId } });
    expect(intent?.status).toBe('CANCELLED');
  });
});
