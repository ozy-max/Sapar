import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';
import { resetRedisClient } from '../../src/adapters/redis/redis.client';

const IDENTITY_PORT = 19111;
const TRIPS_PORT = 19112;
const PAYMENTS_PORT = 19113;
const REDIS_TEST_URL = 'redis://127.0.0.1:6379/1';
const TRIPS_RPM = 4;

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
  process.env['RATE_IDENTITY_RPM'] = '100';
  process.env['RATE_TRIPS_RPM'] = String(TRIPS_RPM);
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

describe('Rate Limit — Trips', () => {
  let app: INestApplication;
  let downstream: MockDownstream;

  beforeAll(async () => {
    downstream = await createMockDownstream(TRIPS_PORT);
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
    for (let i = 0; i < TRIPS_RPM; i++) {
      await request(app.getHttpServer()).get('/trips/search').expect(200);
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    for (let i = 0; i < TRIPS_RPM; i++) {
      await request(app.getHttpServer()).get('/trips/search').expect(200);
    }

    const res = await request(app.getHttpServer())
      .get('/trips/search')
      .expect(429);

    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.message).toBe('Too many requests');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not rate-limit /identity when /trips is exhausted', async () => {
    for (let i = 0; i < TRIPS_RPM; i++) {
      await request(app.getHttpServer()).get('/trips/search').expect(200);
    }
    await request(app.getHttpServer()).get('/trips/search').expect(429);

    // identity has a separate high limit, should still work
    await request(app.getHttpServer()).get('/identity/ping').expect(502);
    // 502 because mock downstream for identity is not started — that's fine,
    // the point is it was NOT rate-limited (no 429).
  });
});
