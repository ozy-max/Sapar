import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signToken } from './helpers/jwt-helper';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/adapters/db/prisma.service';
import { FakePspAdapter } from '../../src/adapters/psp/fake-psp.adapter';

describe('Payment Intents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakePsp: FakePspAdapter;
  let token: string;
  let tokenUserB: string;
  const userId = randomUUID();
  const userIdB = randomUUID();

  beforeAll(async () => {
    resetEnvCache();
    const ctx: TestContext = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    fakePsp = ctx.fakePsp;
    token = signToken(userId);
    tokenUserB = signToken(userIdB);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    fakePsp.setScenario('success');
  });

  describe('POST /payments/intents', () => {
    it('should create intent and place hold (HOLD_PLACED)', async () => {
      const bookingId = randomUUID();

      const res = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'HOLD_PLACED',
        bookingId,
      });
      expect(res.body.paymentIntentId).toBeDefined();
    });

    it('should return same intent for same idempotency key', async () => {
      const bookingId = randomUUID();
      const idempotencyKey = randomUUID();

      const res1 = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      expect(res1.body.paymentIntentId).toBe(res2.body.paymentIntentId);
    });

    it('should return 409 IDMP_CONFLICT for same key but different payload', async () => {
      const idempotencyKey = randomUUID();
      const bookingId1 = randomUUID();
      const bookingId2 = randomUUID();

      await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ bookingId: bookingId1, amountKgs: 1500 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ bookingId: bookingId2, amountKgs: 2000 })
        .expect(409);

      expect(res.body.code).toBe('IDMP_CONFLICT');
    });

    it('should return 401 without auth header', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/intents')
        .send({ bookingId: randomUUID(), amountKgs: 1500 })
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('should return 400 for invalid body', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId: 'not-a-uuid', amountKgs: -100 })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject intent creation for booking owned by another user', async () => {
      const bookingId = randomUUID();

      await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(409);

      expect(res.body.code).toBe('INVALID_PAYMENT_STATE');
    });
  });

  describe('POST /payments/intents/:id/capture', () => {
    it('should capture a HOLD_PLACED intent', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const captureRes = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(captureRes.body).toEqual({ status: 'CAPTURED' });

      const receipt = await prisma.receipt.findFirst({
        where: { paymentIntentId: createRes.body.paymentIntentId },
      });
      expect(receipt).toBeTruthy();
      expect(receipt!.status).toBe('PENDING');
    });

    it('should return 409 when capturing twice', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(res.body.code).toBe('INVALID_PAYMENT_STATE');
    });

    it('should return 403 when different user tries to capture', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should return 404 for non-existent intent', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${randomUUID()}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(res.body.code).toBe('PAYMENT_INTENT_NOT_FOUND');
    });
  });

  describe('POST /payments/intents/:id/cancel', () => {
    it('should cancel a HOLD_PLACED intent', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const cancelRes = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(cancelRes.body).toEqual({ status: 'CANCELLED' });
    });

    it('should return 403 when different user tries to cancel', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/cancel`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should return 409 when cancelling a captured intent', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(res.body.code).toBe('INVALID_PAYMENT_STATE');
    });
  });

  describe('POST /payments/intents/:id/refund', () => {
    it('should refund a CAPTURED intent', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const refundRes = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/refund`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(refundRes.body).toEqual({ status: 'REFUNDED' });
    });

    it('should return 403 when different user tries to refund', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/refund`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should return 409 when refunding before capture', async () => {
      const bookingId = randomUUID();

      const createRes = await request(app.getHttpServer())
        .post('/payments/intents')
        .set('Authorization', `Bearer ${token}`)
        .send({ bookingId, amountKgs: 1500 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${createRes.body.paymentIntentId}/refund`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(res.body.code).toBe('INVALID_PAYMENT_STATE');
    });
  });

  describe('traceId', () => {
    it('should return x-request-id as traceId in errors', async () => {
      const traceId = randomUUID();

      const res = await request(app.getHttpServer())
        .post(`/payments/intents/${randomUUID()}/capture`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', traceId)
        .expect(404);

      expect(res.body.traceId).toBe(traceId);
      expect(res.headers['x-request-id']).toBe(traceId);
    });
  });
});
