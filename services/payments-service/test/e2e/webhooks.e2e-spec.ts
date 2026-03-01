import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signToken } from './helpers/jwt-helper';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/adapters/db/prisma.service';

const WEBHOOK_SECRET = 'test-webhook-secret';

function computeSignature(body: Record<string, unknown>): string {
  const raw = JSON.stringify(body);
  return createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
}

describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  const userId = randomUUID();

  beforeAll(async () => {
    resetEnvCache();
    const ctx: TestContext = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    token = signToken(userId);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  it('should return 401 for invalid webhook signature', async () => {
    const body = {
      eventId: randomUUID(),
      type: 'hold.succeeded',
      pspIntentId: 'fake_hold_abc',
    };

    const res = await request(app.getHttpServer())
      .post('/payments/webhooks/psp')
      .set('x-webhook-signature', 'invalid-signature')
      .send(body)
      .expect(401);

    expect(res.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('should process webhook idempotently (same event twice -> second is no-op)', async () => {
    const bookingId = randomUUID();

    const createRes = await request(app.getHttpServer())
      .post('/payments/intents')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId, amountKgs: 1500 })
      .expect(201);

    const intent = await prisma.paymentIntent.findUnique({
      where: { id: createRes.body.paymentIntentId },
    });

    const body = {
      eventId: randomUUID(),
      type: 'capture.succeeded',
      pspIntentId: intent!.pspIntentId!,
    };
    const sig = computeSignature(body);

    await request(app.getHttpServer())
      .post('/payments/webhooks/psp')
      .set('x-webhook-signature', sig)
      .send(body)
      .expect(204);

    await request(app.getHttpServer())
      .post('/payments/webhooks/psp')
      .set('x-webhook-signature', sig)
      .send(body)
      .expect(204);

    const events = await prisma.paymentEvent.findMany({
      where: { externalEventId: body.eventId },
    });
    expect(events.length).toBe(1);
  });

  it('should handle two concurrent identical webhooks without 500', async () => {
    const bookingId = randomUUID();

    const createRes = await request(app.getHttpServer())
      .post('/payments/intents')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId, amountKgs: 1500 })
      .expect(201);

    const intent = await prisma.paymentIntent.findUnique({
      where: { id: createRes.body.paymentIntentId },
    });

    const body = {
      eventId: randomUUID(),
      type: 'capture.succeeded',
      pspIntentId: intent!.pspIntentId!,
    };
    const sig = computeSignature(body);

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/payments/webhooks/psp')
        .set('x-webhook-signature', sig)
        .send(body),
      request(app.getHttpServer())
        .post('/payments/webhooks/psp')
        .set('x-webhook-signature', sig)
        .send(body),
    ]);

    expect(res1.status).toBeGreaterThanOrEqual(200);
    expect(res1.status).toBeLessThan(300);
    expect(res2.status).toBeGreaterThanOrEqual(200);
    expect(res2.status).toBeLessThan(300);

    const events = await prisma.paymentEvent.findMany({
      where: { externalEventId: body.eventId },
    });
    expect(events.length).toBe(1);
  });

  it('should return 401 when x-webhook-signature header is missing', async () => {
    const body = {
      eventId: randomUUID(),
      type: 'hold.succeeded',
      pspIntentId: 'fake_hold_abc',
    };

    const res = await request(app.getHttpServer())
      .post('/payments/webhooks/psp')
      .send(body)
      .expect(401);

    expect(res.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });
});
