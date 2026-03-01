import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import {
  ADMIN_AUTH,
  OPS_AUTH,
  SUPPORT_AUTH,
  NO_ROLE_AUTH,
  NO_ROLES_CLAIM_AUTH,
} from './helpers/jwt';

describe('RBAC (e2e)', () => {
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

  describe('No token', () => {
    it('should return 401 UNAUTHORIZED', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/configs');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Token with empty roles', () => {
    it('should return 403 FORBIDDEN', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('Authorization', NO_ROLE_AUTH);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Token without roles claim', () => {
    it('should return 403 FORBIDDEN', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('Authorization', NO_ROLES_CLAIM_AUTH);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('ADMIN: full access', () => {
    it('GET /configs -> 200', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('Authorization', ADMIN_AUTH);
      expect(res.status).toBe(200);
    });

    it('PUT /configs/:key -> 200', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/TEST_KEY')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 42 });
      expect(res.status).toBe(200);
    });

    it('DELETE /configs/:key -> 204', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/DEL_KEY')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'STRING', value: 'val' });

      const res = await request(ctx.app.getHttpServer())
        .delete('/configs/DEL_KEY')
        .set('Authorization', ADMIN_AUTH);
      expect(res.status).toBe(204);
    });
  });

  describe('OPS: configs + moderation, no disputes', () => {
    it('GET /configs -> 200', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('Authorization', OPS_AUTH);
      expect(res.status).toBe(200);
    });

    it('PUT /configs/:key -> 200', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/OPS_KEY')
        .set('Authorization', OPS_AUTH)
        .send({ type: 'BOOL', value: true });
      expect(res.status).toBe(200);
    });

    it('DELETE /configs/:key -> 403 (ADMIN only)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .delete('/configs/SOME_KEY')
        .set('Authorization', OPS_AUTH);
      expect(res.status).toBe(403);
    });

    it('POST /disputes -> 403 (SUPPORT/ADMIN only)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/disputes')
        .set('Authorization', OPS_AUTH)
        .send({
          type: 'NO_SHOW',
          bookingId: '00000000-0000-4000-a000-ffffffffffff',
          departAt: new Date(Date.now() + 3600000).toISOString(),
        });
      expect(res.status).toBe(403);
    });
  });

  describe('SUPPORT: disputes + read-only configs', () => {
    it('GET /configs -> 200', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('Authorization', SUPPORT_AUTH);
      expect(res.status).toBe(200);
    });

    it('PUT /configs/:key -> 403 (ADMIN/OPS only)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/SUP_KEY')
        .set('Authorization', SUPPORT_AUTH)
        .send({ type: 'INT', value: 1 });
      expect(res.status).toBe(403);
    });

    it('POST /disputes -> 201', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/disputes')
        .set('Authorization', SUPPORT_AUTH)
        .send({
          type: 'NO_SHOW',
          bookingId: '00000000-0000-4000-a000-ffffffffffff',
          departAt: new Date(Date.now() + 86400000).toISOString(),
        });
      expect(res.status).toBe(201);
    });

    it('POST /moderation/users/:id/ban -> 403 (ADMIN/OPS only)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/moderation/users/00000000-0000-4000-a000-ffffffffffff/ban')
        .set('Authorization', SUPPORT_AUTH)
        .send({ reason: 'test' });
      expect(res.status).toBe(403);
    });
  });

  describe('traceId propagation', () => {
    it('should return traceId equal to x-request-id on error responses', async () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440099';
      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('x-request-id', requestId);

      expect(res.status).toBe(401);
      expect(res.body.traceId).toBe(requestId);
      expect(res.headers['x-request-id']).toBe(requestId);
    });
  });
});
