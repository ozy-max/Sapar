import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

const IDENTITY_PORT = 19051;
const SMALL_LIMIT = 256;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = `http://127.0.0.1:${IDENTITY_PORT}`;
  process.env['TRIPS_BASE_URL'] = 'http://127.0.0.1:19052';
  process.env['PAYMENTS_BASE_URL'] = 'http://127.0.0.1:19053';
  process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19005';
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['MAX_BODY_BYTES'] = String(SMALL_LIMIT);
  resetEnvCache();
  resetSharedDispatcher();
});

describe('Payload Size Limit', () => {
  let app: INestApplication;
  let downstream: MockDownstream;

  beforeAll(async () => {
    downstream = await createMockDownstream(IDENTITY_PORT);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await downstream?.close();
  });

  beforeEach(() => {
    downstream.lastRequest = null;
  });

  it('returns 413 when payload exceeds MAX_BODY_BYTES', async () => {
    const largeBody = { data: 'x'.repeat(SMALL_LIMIT * 2) };

    const res = await request(app.getHttpServer())
      .post('/identity/upload')
      .send(largeBody)
      .set('content-type', 'application/json')
      .set('x-request-id', 'payload-trace-1');

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      traceId: 'payload-trace-1',
    });
  });

  it('does NOT call downstream when payload is too large', async () => {
    const largeBody = { data: 'x'.repeat(SMALL_LIMIT * 2) };

    await request(app.getHttpServer())
      .post('/identity/upload')
      .send(largeBody)
      .set('content-type', 'application/json');

    expect(downstream.lastRequest).toBeNull();
  });

  it('allows payload within limits', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };

    const smallBody = { data: 'ok' };

    const res = await request(app.getHttpServer())
      .post('/identity/upload')
      .send(smallBody)
      .set('content-type', 'application/json')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(downstream.lastRequest).not.toBeNull();
  });
});
