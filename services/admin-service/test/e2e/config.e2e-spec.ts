import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import { ADMIN_AUTH, ADMIN_USER_ID } from './helpers/jwt';

describe('Config CRUD (e2e)', () => {
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

  describe('PUT /configs/:key (upsert)', () => {
    it('should create a new INT config', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/RECEIPT_RETRY_N')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 3, description: 'Max retries' });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('RECEIPT_RETRY_N');
      expect(res.body.type).toBe('INT');
      expect(res.body.value).toBe(3);
    });

    it('should update an existing config', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/RETRY')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 3 });

      const res = await request(ctx.app.getHttpServer())
        .put('/configs/RETRY')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 5 });

      expect(res.status).toBe(200);
      expect(res.body.value).toBe(5);
    });

    it('should reject FLOAT when value is string', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/BAD')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'FLOAT', value: 'not-a-number' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject BOOL when value is not boolean', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/FLAG')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'BOOL', value: 'yes' });

      expect(res.status).toBe(400);
    });

    it('should reject INT when value exceeds constraints.max', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/BOUNDED')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 200, constraints: { min: 0, max: 100 } });

      expect(res.status).toBe(400);
    });

    it('should accept STRING config', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/GREETING')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'STRING', value: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.body.value).toBe('Hello');
    });

    it('should accept JSON config', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/configs/COMPLEX')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'JSON', value: { nested: { arr: [1, 2, 3] } } });

      expect(res.status).toBe(200);
      expect(res.body.value).toEqual({ nested: { arr: [1, 2, 3] } });
    });
  });

  describe('GET /configs', () => {
    it('should return all configs', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/A')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 1 });
      await request(ctx.app.getHttpServer())
        .put('/configs/B')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'STRING', value: 'x' });

      const res = await request(ctx.app.getHttpServer())
        .get('/configs')
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });
  });

  describe('GET /configs/:key', () => {
    it('should return config by key', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/MY_KEY')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'BOOL', value: true });

      const res = await request(ctx.app.getHttpServer())
        .get('/configs/MY_KEY')
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('MY_KEY');
      expect(res.body.value).toBe(true);
    });

    it('should return 404 for non-existent key', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/configs/NOPE')
        .set('Authorization', ADMIN_AUTH);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CONFIG_NOT_FOUND');
    });
  });

  describe('DELETE /configs/:key', () => {
    it('should delete config and return 204', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/TO_DELETE')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 99 });

      const del = await request(ctx.app.getHttpServer())
        .delete('/configs/TO_DELETE')
        .set('Authorization', ADMIN_AUTH);
      expect(del.status).toBe(204);

      const get = await request(ctx.app.getHttpServer())
        .get('/configs/TO_DELETE')
        .set('Authorization', ADMIN_AUTH);
      expect(get.status).toBe(404);
    });

    it('should return 404 when deleting non-existent key', async () => {
      const res = await request(ctx.app.getHttpServer())
        .delete('/configs/GHOST')
        .set('Authorization', ADMIN_AUTH);
      expect(res.status).toBe(404);
    });
  });

  describe('Audit records', () => {
    it('should create audit record on upsert', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/AUDITED')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'INT', value: 10 });

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'Config', targetId: 'AUDITED' },
      });

      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe('CONFIG_UPSERT');
      expect(audits[0].actorUserId).toBe(ADMIN_USER_ID);
      expect(audits[0].actorRoles).toContain('ADMIN');
    });

    it('should create audit record on delete', async () => {
      await request(ctx.app.getHttpServer())
        .put('/configs/DEL_AUD')
        .set('Authorization', ADMIN_AUTH)
        .send({ type: 'STRING', value: 'bye' });

      await request(ctx.app.getHttpServer())
        .delete('/configs/DEL_AUD')
        .set('Authorization', ADMIN_AUTH);

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'Config', targetId: 'DEL_AUD', action: 'CONFIG_DELETE' },
      });

      expect(audits).toHaveLength(1);
    });
  });
});
