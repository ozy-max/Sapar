import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import { ADMIN_AUTH, SUPPORT_AUTH, ADMIN_USER_ID } from './helpers/jwt';

describe('Disputes (e2e)', () => {
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
  });

  const futureDepart = (): string => new Date(Date.now() + 86400000).toISOString();
  const pastDepart = (): string => new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();

  async function createDispute(departAt?: string): Promise<string> {
    const res = await request(ctx.app.getHttpServer())
      .post('/disputes')
      .set('Authorization', ADMIN_AUTH)
      .send({
        type: 'NO_SHOW',
        bookingId: '00000000-0000-4000-a000-ffffffffffff',
        departAt: departAt ?? futureDepart(),
      });
    return res.body.id;
  }

  describe('POST /disputes', () => {
    it('should create a dispute and return 201', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/disputes')
        .set('Authorization', SUPPORT_AUTH)
        .send({
          type: 'NO_SHOW',
          bookingId: '00000000-0000-4000-a000-ffffffffffff',
          departAt: futureDepart(),
          evidenceUrls: ['https://example.com/photo.jpg'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('NO_SHOW');
      expect(res.body.status).toBe('OPEN');
    });

    it('should create audit record', async () => {
      const disputeId = await createDispute();

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'Dispute', targetId: disputeId, action: 'DISPUTE_CREATE' },
      });
      expect(audits).toHaveLength(1);
    });
  });

  describe('GET /disputes/:id', () => {
    it('should return dispute by ID', async () => {
      const disputeId = await createDispute();

      const res = await request(ctx.app.getHttpServer())
        .get(`/disputes/${disputeId}`)
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(disputeId);
      expect(res.body.status).toBe('OPEN');
    });

    it('should return 404 for non-existent dispute', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/disputes/00000000-0000-4000-a000-ffffffffffff')
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('DISPUTE_NOT_FOUND');
    });
  });

  describe('POST /disputes/:id/resolve', () => {
    it('should resolve dispute within SLA window', async () => {
      const disputeId = await createDispute(futureDepart());

      const res = await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/resolve`)
        .set('Authorization', ADMIN_AUTH)
        .send({ resolution: 'REFUND' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RESOLVED');
      expect(res.body.resolution).toBe('REFUND');
      expect(res.body.resolvedBy).toBe(ADMIN_USER_ID);
    });

    it('should return 409 SLA_WINDOW_EXPIRED when past SLA', async () => {
      const disputeId = await createDispute(pastDepart());

      const res = await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/resolve`)
        .set('Authorization', ADMIN_AUTH)
        .send({ resolution: 'NO_REFUND' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SLA_WINDOW_EXPIRED');
    });

    it('should return 409 INVALID_STATE when already resolved', async () => {
      const disputeId = await createDispute(futureDepart());

      await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/resolve`)
        .set('Authorization', ADMIN_AUTH)
        .send({ resolution: 'REFUND' });

      const res = await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/resolve`)
        .set('Authorization', ADMIN_AUTH)
        .send({ resolution: 'NO_REFUND' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATE');
    });

    it('should create audit record on resolve', async () => {
      const disputeId = await createDispute(futureDepart());

      await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/resolve`)
        .set('Authorization', ADMIN_AUTH)
        .send({ resolution: 'PARTIAL' });

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'Dispute', targetId: disputeId, action: 'DISPUTE_RESOLVE' },
      });
      expect(audits).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(audits[0].payloadJson))).toHaveProperty('resolution', 'PARTIAL');
    });
  });

  describe('POST /disputes/:id/close', () => {
    it('should close an open dispute', async () => {
      const disputeId = await createDispute();

      const res = await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/close`)
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CLOSED');
    });

    it('should close a resolved dispute', async () => {
      const disputeId = await createDispute(futureDepart());

      await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/resolve`)
        .set('Authorization', ADMIN_AUTH)
        .send({ resolution: 'REFUND' });

      const res = await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/close`)
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CLOSED');
    });

    it('should return 409 when already closed', async () => {
      const disputeId = await createDispute();

      await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/close`)
        .set('Authorization', ADMIN_AUTH);

      const res = await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/close`)
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATE');
    });

    it('should create audit record on close', async () => {
      const disputeId = await createDispute();

      await request(ctx.app.getHttpServer())
        .post(`/disputes/${disputeId}/close`)
        .set('Authorization', ADMIN_AUTH);

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'Dispute', targetId: disputeId, action: 'DISPUTE_CLOSE' },
      });
      expect(audits).toHaveLength(1);
    });
  });
});
