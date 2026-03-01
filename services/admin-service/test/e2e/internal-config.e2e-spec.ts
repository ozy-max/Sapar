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

describe('Internal Config API (e2e)', () => {
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

  it('should return configs with ETag header', async () => {
    await request(ctx.app.getHttpServer())
      .put('/configs/TEST_KEY')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'INT', value: 42 });

    const res = await request(ctx.app.getHttpServer()).get('/internal/configs').set(hmacHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].key).toBe('TEST_KEY');
    expect(res.body.items[0].version).toBe(1);
    expect(res.body.meta.traceId).toBeDefined();
    expect(res.headers['etag']).toBe('"v1"');
  });

  it('should return 304 when ETag matches', async () => {
    await request(ctx.app.getHttpServer())
      .put('/configs/KEY_A')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'STRING', value: 'hello' });

    const first = await request(ctx.app.getHttpServer())
      .get('/internal/configs')
      .set(hmacHeaders());

    expect(first.status).toBe(200);
    const etag = first.headers['etag'];

    const second = await request(ctx.app.getHttpServer())
      .get('/internal/configs')
      .set({ ...hmacHeaders(), 'If-None-Match': etag });

    expect(second.status).toBe(304);
  });

  it('should return new data when ETag does not match after update', async () => {
    await request(ctx.app.getHttpServer())
      .put('/configs/VER_KEY')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'INT', value: 1 });

    const first = await request(ctx.app.getHttpServer())
      .get('/internal/configs')
      .set(hmacHeaders());

    const etagBefore = first.headers['etag'];

    await request(ctx.app.getHttpServer())
      .put('/configs/VER_KEY')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'INT', value: 2 });

    const second = await request(ctx.app.getHttpServer())
      .get('/internal/configs')
      .set({ ...hmacHeaders(), 'If-None-Match': etagBefore });

    expect(second.status).toBe(200);
    expect(second.body.items[0].version).toBe(2);
    expect(second.headers['etag']).toBe('"v2"');
  });

  it('should filter configs by keys query param', async () => {
    await request(ctx.app.getHttpServer())
      .put('/configs/A')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'INT', value: 1 });
    await request(ctx.app.getHttpServer())
      .put('/configs/B')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'INT', value: 2 });
    await request(ctx.app.getHttpServer())
      .put('/configs/C')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'INT', value: 3 });

    const res = await request(ctx.app.getHttpServer())
      .get('/internal/configs?keys=A,C')
      .set(hmacHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const keys = res.body.items.map((i: { key: string }) => i.key);
    expect(keys).toContain('A');
    expect(keys).toContain('C');
    expect(keys).not.toContain('B');
  });

  it('should return individual config by key', async () => {
    await request(ctx.app.getHttpServer())
      .put('/configs/SINGLE')
      .set('Authorization', ADMIN_AUTH)
      .send({ type: 'BOOL', value: true });

    const res = await request(ctx.app.getHttpServer())
      .get('/internal/configs/SINGLE')
      .set(hmacHeaders());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].key).toBe('SINGLE');
    expect(res.body.items[0].valueJson).toBe(true);
  });

  it('should return 404 for non-existent key', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/internal/configs/NOPE')
      .set(hmacHeaders());

    expect(res.status).toBe(404);
  });

  it('should reject request without HMAC', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/internal/configs');

    expect(res.status).toBe(401);
  });

  it('should reject request with invalid HMAC', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/internal/configs')
      .set({
        'X-Event-Signature': 'deadbeef',
        'X-Event-Timestamp': String(Math.floor(Date.now() / 1000)),
      });

    expect(res.status).toBe(401);
  });
});
