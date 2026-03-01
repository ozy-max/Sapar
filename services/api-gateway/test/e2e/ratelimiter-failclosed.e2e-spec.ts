import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';
import { resetRedisClient } from '../../src/adapters/redis/redis.client';

const IDENTITY_PORT = 19141;
const TRIPS_PORT = 19142;
const PAYMENTS_PORT = 19143;

const REDIS_BAD_URL = 'redis://127.0.0.1:1/0';

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = `http://127.0.0.1:${IDENTITY_PORT}`;
  process.env['TRIPS_BASE_URL'] = `http://127.0.0.1:${TRIPS_PORT}`;
  process.env['PAYMENTS_BASE_URL'] = `http://127.0.0.1:${PAYMENTS_PORT}`;
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['MAX_BODY_BYTES'] = '1048576';
  process.env['REDIS_URL'] = REDIS_BAD_URL;
  process.env['REDIS_TIMEOUT_MS'] = '200';
  process.env['RATE_IDENTITY_RPM'] = '5';
  process.env['RATE_TRIPS_RPM'] = '5';
  process.env['RATE_PAYMENTS_RPM'] = '5';
  process.env['RATE_LIMIT_WINDOW_SEC'] = '60';
  process.env['TRUST_PROXY'] = 'false';
  resetEnvCache();
  resetSharedDispatcher();
  resetRedisClient();
});

describe('Rate Limiter Fail-Closed (/payments)', () => {
  let app: INestApplication;
  let downstream: MockDownstream;

  beforeAll(async () => {
    downstream = await createMockDownstream(PAYMENTS_PORT);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await downstream?.close();
    resetRedisClient();
  });

  it('returns 503 for /payments when Redis is down (fail-closed)', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/charge')
      .send({ amount: 100 })
      .set('content-type', 'application/json')
      .expect(503);

    expect(res.body.code).toBe('RATE_LIMITER_UNAVAILABLE');
    expect(res.body.message).toBe('Rate limiter is temporarily unavailable');
    expect(res.body.traceId).toBeDefined();
  });

  it('includes traceId from x-request-id in 503 response', async () => {
    const traceId = 'trace-failclosed-456';
    const res = await request(app.getHttpServer())
      .post('/payments/charge')
      .send({ amount: 100 })
      .set('content-type', 'application/json')
      .set('x-request-id', traceId)
      .expect(503);

    expect(res.body.traceId).toBe(traceId);
    expect(res.headers['x-request-id']).toBe(traceId);
  });

  it('does NOT block /health or /ready when Redis is down', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);

    const readyRes = await request(app.getHttpServer()).get('/ready');
    // /ready may return 503 because DB is unavailable in this test — that's fine.
    // The assertion is that it's NOT 429 (rate-limited) or 503 from the rate limiter.
    expect(readyRes.body.code).not.toBe('RATE_LIMITED');
    expect(readyRes.body.code).not.toBe('RATE_LIMITER_UNAVAILABLE');
  });
});
