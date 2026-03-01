import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import { ADMIN_AUTH } from './helpers/jwt';
import { signPayload } from '../../src/shared/hmac';

const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

function hmacHeaders(body = ''): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(body, timestamp, HMAC_SECRET);
  return {
    'X-Event-Signature': signature,
    'X-Event-Timestamp': String(timestamp),
  };
}

function hmacPostHeaders(body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(body, timestamp, HMAC_SECRET);
  return {
    'Content-Type': 'application/json',
    'X-Event-Signature': signature,
    'X-Event-Timestamp': String(timestamp),
  };
}

describe('Internal Commands API (e2e)', () => {
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

  it('should return pending commands for a service', async () => {
    await request(ctx.app.getHttpServer())
      .post('/moderation/users/00000000-0000-4000-a000-000000000099/ban')
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-ban-1')
      .send({ reason: 'test ban' });

    const res = await request(ctx.app.getHttpServer())
      .get('/internal/commands?service=identity&limit=10')
      .set(hmacHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    const cmd = res.body.items[0];
    expect(cmd.type).toBe('BAN_USER');
    expect(cmd.payload).toBeDefined();
    expect(cmd.traceId).toBeDefined();
  });

  it('should ack command as APPLIED', async () => {
    const modRes = await request(ctx.app.getHttpServer())
      .post('/moderation/users/00000000-0000-4000-a000-000000000099/ban')
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-ban-2')
      .send({ reason: 'test ban' });

    const commandId = modRes.body.commandId;

    const ackBody = JSON.stringify({ status: 'APPLIED' });
    const res = await request(ctx.app.getHttpServer())
      .post(`/internal/commands/${commandId}/ack`)
      .set(hmacPostHeaders(ackBody))
      .send({ status: 'APPLIED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPLIED');

    const dbCmd = await ctx.prisma.adminCommand.findUnique({ where: { id: commandId } });
    expect(dbCmd?.status).toBe('APPLIED');
  });

  it('should ack command as FAILED_RETRY', async () => {
    const modRes = await request(ctx.app.getHttpServer())
      .post('/moderation/trips/00000000-0000-4000-a000-000000000099/cancel')
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-cancel-1')
      .send({ reason: 'test cancel' });

    const commandId = modRes.body.commandId;

    const ackBody = JSON.stringify({ status: 'FAILED_RETRY', error: 'Connection refused' });
    const res = await request(ctx.app.getHttpServer())
      .post(`/internal/commands/${commandId}/ack`)
      .set(hmacPostHeaders(ackBody))
      .send({ status: 'FAILED_RETRY', error: 'Connection refused' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED_RETRY');

    const dbCmd = await ctx.prisma.adminCommand.findUnique({ where: { id: commandId } });
    expect(dbCmd?.status).toBe('FAILED_RETRY');
    expect(dbCmd?.tryCount).toBe(1);
    expect(dbCmd?.lastError).toBe('Connection refused');
  });

  it('should transition to FAILED_FINAL after max retries', async () => {
    const modRes = await request(ctx.app.getHttpServer())
      .post('/moderation/users/00000000-0000-4000-a000-000000000099/unban')
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-unban-1')
      .send({ reason: 'test unban' });

    const commandId = modRes.body.commandId;

    for (let i = 0; i < 3; i++) {
      const ackBody = JSON.stringify({ status: 'FAILED_RETRY', error: `fail-${i}` });
      await request(ctx.app.getHttpServer())
        .post(`/internal/commands/${commandId}/ack`)
        .set(hmacPostHeaders(ackBody))
        .send({ status: 'FAILED_RETRY', error: `fail-${i}` });
    }

    const dbCmd = await ctx.prisma.adminCommand.findUnique({ where: { id: commandId } });
    expect(dbCmd?.status).toBe('FAILED_FINAL');
  });

  it('should not return already APPLIED commands', async () => {
    const modRes = await request(ctx.app.getHttpServer())
      .post('/moderation/users/00000000-0000-4000-a000-000000000099/ban')
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-ban-applied')
      .send({ reason: 'test' });

    const commandId = modRes.body.commandId;

    const ackBody = JSON.stringify({ status: 'APPLIED' });
    await request(ctx.app.getHttpServer())
      .post(`/internal/commands/${commandId}/ack`)
      .set(hmacPostHeaders(ackBody))
      .send({ status: 'APPLIED' });

    const res = await request(ctx.app.getHttpServer())
      .get('/internal/commands?service=identity&limit=10')
      .set(hmacHeaders());

    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(commandId);
  });
});
