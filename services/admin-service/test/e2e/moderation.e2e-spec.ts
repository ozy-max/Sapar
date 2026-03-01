import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import { ADMIN_AUTH, OPS_AUTH, ADMIN_USER_ID } from './helpers/jwt';

const TARGET_USER_ID = '00000000-0000-4000-a000-aaaaaaaaaa01';
const TARGET_TRIP_ID = '00000000-0000-4000-a000-bbbbbbbbbb01';

describe('Moderation (e2e)', () => {
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

  describe('POST /moderation/users/:userId/ban', () => {
    it('ADMIN should ban a user (201)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post(`/moderation/users/${TARGET_USER_ID}/ban`)
        .set('Authorization', ADMIN_AUTH)
        .send({ reason: 'Repeated violations' });

      expect(res.status).toBe(201);
      expect(res.body.commandId).toBeDefined();
      expect(res.body.status).toBe('PENDING');
    });

    it('OPS should ban a user (201)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post(`/moderation/users/${TARGET_USER_ID}/ban`)
        .set('Authorization', OPS_AUTH)
        .send({ reason: 'Spam', until: '2025-12-31T23:59:59.000Z' });

      expect(res.status).toBe(201);
    });

    it('should create AdminCommand record', async () => {
      await request(ctx.app.getHttpServer())
        .post(`/moderation/users/${TARGET_USER_ID}/ban`)
        .set('Authorization', ADMIN_AUTH)
        .send({ reason: 'Test ban' });

      const commands = await ctx.prisma.adminCommand.findMany({
        where: { type: 'BAN_USER' },
      });
      expect(commands).toHaveLength(1);
      expect(commands[0].createdBy).toBe(ADMIN_USER_ID);
    });

    it('should create audit record', async () => {
      await request(ctx.app.getHttpServer())
        .post(`/moderation/users/${TARGET_USER_ID}/ban`)
        .set('Authorization', ADMIN_AUTH)
        .send({ reason: 'Audit test' });

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'User', targetId: TARGET_USER_ID, action: 'USER_BAN' },
      });
      expect(audits).toHaveLength(1);
    });
  });

  describe('POST /moderation/users/:userId/unban', () => {
    it('should unban a user (201)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post(`/moderation/users/${TARGET_USER_ID}/unban`)
        .set('Authorization', ADMIN_AUTH)
        .send({ reason: 'Appealed successfully' });

      expect(res.status).toBe(201);
      expect(res.body.commandId).toBeDefined();
    });

    it('should create audit record', async () => {
      await request(ctx.app.getHttpServer())
        .post(`/moderation/users/${TARGET_USER_ID}/unban`)
        .set('Authorization', ADMIN_AUTH)
        .send({ reason: 'Unban test' });

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'User', targetId: TARGET_USER_ID, action: 'USER_UNBAN' },
      });
      expect(audits).toHaveLength(1);
    });
  });

  describe('POST /moderation/trips/:tripId/cancel', () => {
    it('should cancel a trip (201)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post(`/moderation/trips/${TARGET_TRIP_ID}/cancel`)
        .set('Authorization', ADMIN_AUTH)
        .send({ reason: 'Fraudulent listing' });

      expect(res.status).toBe(201);
      expect(res.body.commandId).toBeDefined();
    });

    it('should create audit record', async () => {
      await request(ctx.app.getHttpServer())
        .post(`/moderation/trips/${TARGET_TRIP_ID}/cancel`)
        .set('Authorization', OPS_AUTH)
        .send({ reason: 'Trip cancel test' });

      const audits = await ctx.prisma.auditLog.findMany({
        where: { targetType: 'Trip', targetId: TARGET_TRIP_ID, action: 'TRIP_CANCEL' },
      });
      expect(audits).toHaveLength(1);
    });
  });
});
