import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';
import { resetRedisClient } from '../../src/adapters/redis/redis.client';

const IDENTITY_PORT = 19131;
const TRIPS_PORT = 19132;
const PAYMENTS_PORT = 19133;

/**
 * Point Redis to a port where nothing listens.
 * enableOfflineQueue=false in redis.client.ts guarantees commands
 * are rejected immediately, so tests stay fast.
 */
const REDIS_BAD_URL = 'redis://127.0.0.1:1/0';

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = `http://127.0.0.1:${IDENTITY_PORT}`;
  process.env['TRIPS_BASE_URL'] = `http://127.0.0.1:${TRIPS_PORT}`;
  process.env['PAYMENTS_BASE_URL'] = `http://127.0.0.1:${PAYMENTS_PORT}`;
  process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19005';
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

describe('Rate Limiter Fail-Open (/identity, /trips)', () => {
  let app: INestApplication;
  let identityDs: MockDownstream;
  let tripsDs: MockDownstream;

  beforeAll(async () => {
    identityDs = await createMockDownstream(IDENTITY_PORT);
    tripsDs = await createMockDownstream(TRIPS_PORT);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await identityDs?.close();
    await tripsDs?.close();
    resetRedisClient();
  });

  beforeEach(() => {
    identityDs.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
    tripsDs.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
  });

  it('/identity requests pass through when Redis is down (fail-open)', async () => {
    const res = await request(app.getHttpServer()).get('/identity/ping').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('/trips requests pass through when Redis is down (fail-open)', async () => {
    const res = await request(app.getHttpServer()).get('/trips/search').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('preserves x-request-id even in fail-open mode', async () => {
    const traceId = 'trace-failopen-123';
    const res = await request(app.getHttpServer())
      .get('/identity/ping')
      .set('x-request-id', traceId)
      .expect(200);
    expect(res.headers['x-request-id']).toBe(traceId);
  });
});
