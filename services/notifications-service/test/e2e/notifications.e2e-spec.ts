import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signToken } from './helpers/jwt-helper';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/adapters/db/prisma.service';
import { FakeEmailProvider } from '../../src/adapters/providers/fake-email.provider';
import { FakePushProvider } from '../../src/adapters/providers/fake-push.provider';
import { ProcessNotificationsUseCase } from '../../src/application/process-notifications.usecase';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeEmail: FakeEmailProvider;
  let fakePush: FakePushProvider;
  let processNotifications: ProcessNotificationsUseCase;
  let token: string;
  const userId = randomUUID();

  beforeAll(async () => {
    resetEnvCache();
    const ctx: TestContext = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    fakeEmail = ctx.fakeEmail;
    fakePush = ctx.fakePush;
    processNotifications = ctx.processNotifications;
    token = signToken(userId);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    fakeEmail.setScenario('success');
    fakePush.setScenario('success');
  });

  // 1) enqueue notification success (PENDING)
  describe('POST /notifications', () => {
    it('should enqueue a notification as PENDING', async () => {
      const res = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId,
          channel: 'EMAIL',
          templateKey: 'BOOKING_CONFIRMED',
          payload: { bookingId: 'b-1', route: 'Bishkek → Osh', date: '2026-04-01', userName: 'Test' },
        })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'PENDING',
      });
      expect(res.body.notificationId).toBeDefined();
    });

    // 2) idempotency returns same notificationId
    it('should return same notificationId for identical idempotency key', async () => {
      const idempotencyKey = `idem-${randomUUID()}`;
      const body = {
        userId,
        channel: 'EMAIL',
        templateKey: 'BOOKING_CONFIRMED',
        payload: { bookingId: 'b-2', route: 'Bishkek → Osh', date: '2026-04-02', userName: 'Test' },
      };

      const res1 = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(res1.body.notificationId).toBe(res2.body.notificationId);
    });

    // 3) idempotency conflict on different payload -> 409
    it('should return 409 for same idempotency key with different payload', async () => {
      const idempotencyKey = `idem-${randomUUID()}`;

      await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          userId,
          channel: 'EMAIL',
          templateKey: 'BOOKING_CONFIRMED',
          payload: { bookingId: 'b-3', route: 'Bishkek → Osh', date: '2026-04-03', userName: 'Test' },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          userId,
          channel: 'EMAIL',
          templateKey: 'PAYMENT_CAPTURED',
          payload: { bookingId: 'b-3', amountKgs: 500, userName: 'Test' },
        })
        .expect(409);

      expect(res.body.code).toBe('IDMP_CONFLICT');
    });
  });

  // 4) worker sends -> SENT
  describe('Worker processing', () => {
    it('should send notification via worker and mark SENT', async () => {
      fakeEmail.setScenario('success');

      const res = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId,
          channel: 'EMAIL',
          templateKey: 'BOOKING_CONFIRMED',
          payload: { bookingId: 'b-4', route: 'Bishkek → Osh', date: '2026-04-04', userName: 'Test' },
        })
        .expect(201);

      const notifId = res.body.notificationId as string;

      await processNotifications.processOnce();

      const detail = await request(app.getHttpServer())
        .get(`/notifications/${notifId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('SENT');
      expect(detail.body.providerMessageId).toBeTruthy();
    });

    // 5) worker retries -> FAILED_FINAL after N
    it('should mark FAILED_FINAL after max retries', async () => {
      fakeEmail.setScenario('failure');

      const res = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId,
          channel: 'EMAIL',
          templateKey: 'BOOKING_CONFIRMED',
          payload: { bookingId: 'b-5', route: 'Bishkek → Osh', date: '2026-04-05', userName: 'Test' },
        })
        .expect(201);

      const notifId = res.body.notificationId as string;

      // NOTIF_RETRY_N=3, backoff=[0,0,0] so all retries happen immediately
      for (let i = 0; i < 3; i++) {
        // For retries after the first, update nextRetryAt to now so it's picked up
        if (i > 0) {
          await prisma.notification.update({
            where: { id: notifId },
            data: { nextRetryAt: new Date() },
          });
        }
        await processNotifications.processOnce();
      }

      const detail = await request(app.getHttpServer())
        .get(`/notifications/${notifId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('FAILED_FINAL');
      expect(detail.body.tryCount).toBe(3);
    });
  });

  // 6) cancel prevents send (CANCELLED)
  describe('POST /notifications/:id/cancel', () => {
    it('should cancel a PENDING notification and prevent send', async () => {
      const res = await request(app.getHttpServer())
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId,
          channel: 'EMAIL',
          templateKey: 'BOOKING_CONFIRMED',
          payload: { bookingId: 'b-6', route: 'Bishkek → Osh', date: '2026-04-06', userName: 'Test' },
        })
        .expect(201);

      const notifId = res.body.notificationId as string;

      const cancelRes = await request(app.getHttpServer())
        .post(`/notifications/${notifId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      await processNotifications.processOnce();

      const detail = await request(app.getHttpServer())
        .get(`/notifications/${notifId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detail.body.status).toBe('CANCELLED');
    });
  });

  // 7) traceId equals x-request-id for errors
  describe('traceId propagation', () => {
    it('should return traceId matching x-request-id header on errors', async () => {
      const traceId = randomUUID();

      const res = await request(app.getHttpServer())
        .get(`/notifications/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-request-id', traceId)
        .expect(404);

      expect(res.body.traceId).toBe(traceId);
      expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
    });
  });
});
