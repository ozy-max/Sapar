import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';
import { resetRedisClient } from '../../src/adapters/redis/redis.client';

const IDENTITY_PORT = 19101;
const TRIPS_PORT = 19102;
const PAYMENTS_PORT = 19103;
const REDIS_TEST_URL = 'redis://127.0.0.1:6379/1';
const IDENTITY_RPM = 5;

let testRedis: Redis;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = `http://127.0.0.1:${IDENTITY_PORT}`;
  process.env['TRIPS_BASE_URL'] = `http://127.0.0.1:${TRIPS_PORT}`;
  process.env['PAYMENTS_BASE_URL'] = `http://127.0.0.1:${PAYMENTS_PORT}`;
  process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19005';
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['MAX_BODY_BYTES'] = '1048576';
  process.env['REDIS_URL'] = REDIS_TEST_URL;
  process.env['REDIS_TIMEOUT_MS'] = '2000';
  process.env['RATE_IDENTITY_RPM'] = String(IDENTITY_RPM);
  process.env['RATE_TRIPS_RPM'] = '100';
  process.env['RATE_PAYMENTS_RPM'] = '100';
  process.env['RATE_LIMIT_WINDOW_SEC'] = '60';
  process.env['TRUST_PROXY'] = 'false';
  resetEnvCache();
  resetSharedDispatcher();
  resetRedisClient();

  testRedis = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: 0 });
});

afterAll(async () => {
  testRedis.disconnect();
});

describe('Rate Limit — Identity', () => {
  let app: INestApplication;
  let downstream: MockDownstream;

  beforeAll(async () => {
    downstream = await createMockDownstream(IDENTITY_PORT);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await downstream?.close();
    resetRedisClient();
  });

  beforeEach(async () => {
    await testRedis.flushdb();
    downstream.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < IDENTITY_RPM; i++) {
      const res = await request(app.getHttpServer())
        .get('/identity/ping')
        .expect(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    for (let i = 0; i < IDENTITY_RPM; i++) {
      await request(app.getHttpServer()).get('/identity/ping').expect(200);
    }

    const res = await request(app.getHttpServer())
      .get('/identity/ping')
      .expect(429);

    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.message).toBe('Too many requests');
    expect(res.body.details).toBeDefined();
    expect(res.body.details.retryAfterSec).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('includes traceId matching x-request-id in 429 response', async () => {
    for (let i = 0; i < IDENTITY_RPM; i++) {
      await request(app.getHttpServer()).get('/identity/ping').expect(200);
    }

    const customTraceId = 'trace-abc-123';
    const res = await request(app.getHttpServer())
      .get('/identity/ping')
      .set('x-request-id', customTraceId)
      .expect(429);

    expect(res.body.traceId).toBe(customTraceId);
    expect(res.headers['x-request-id']).toBe(customTraceId);
  });

  it('different keys do not share counters', async () => {
    for (let i = 0; i < IDENTITY_RPM; i++) {
      await request(app.getHttpServer())
        .get('/identity/ping')
        .set('Authorization', 'Bearer user-A-token')
        .expect(200);
    }

    // user-A is rate-limited
    await request(app.getHttpServer())
      .get('/identity/ping')
      .set('Authorization', 'Bearer user-A-token')
      .expect(429);

    // user-B still has a separate bucket
    const res = await request(app.getHttpServer())
      .get('/identity/ping')
      .set('Authorization', 'Bearer user-B-token')
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('preserves x-request-id on proxied (non-limited) requests', async () => {
    const traceId = 'trace-proxy-pass';
    const res = await request(app.getHttpServer())
      .get('/identity/ping')
      .set('x-request-id', traceId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(traceId);
  });
});
