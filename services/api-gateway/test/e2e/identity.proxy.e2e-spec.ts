import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

const IDENTITY_PORT = 19001;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = `http://127.0.0.1:${IDENTITY_PORT}`;
  process.env['TRIPS_BASE_URL'] = 'http://127.0.0.1:19002';
  process.env['PAYMENTS_BASE_URL'] = 'http://127.0.0.1:19003';
  process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19005';
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['MAX_BODY_BYTES'] = '1048576';
  resetEnvCache();
  resetSharedDispatcher();
});

describe('Identity Proxy', () => {
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
    downstream.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: 'identity', ok: true }));
    };
  });

  it('GET /identity/ping -> proxies to downstream', async () => {
    const res = await request(app.getHttpServer()).get('/identity/ping').expect(200);

    expect(res.body).toEqual({ service: 'identity', ok: true });
    expect(downstream.lastRequest).not.toBeNull();
    expect(downstream.lastRequest?.url).toBe('/ping');
    expect(downstream.lastRequest?.method).toBe('GET');
  });

  it('POST /identity/users -> proxies body and method', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'u1' }));
    };

    const res = await request(app.getHttpServer())
      .post('/identity/users')
      .send({ name: 'test' })
      .set('content-type', 'application/json')
      .expect(201);

    expect(res.body).toEqual({ id: 'u1' });
    expect(downstream.lastRequest?.method).toBe('POST');
    expect(JSON.parse(downstream.lastRequest?.body ?? '{}')).toEqual({ name: 'test' });
  });

  it('forwards custom x-request-id', async () => {
    const customId = 'custom-trace-id-123';

    await request(app.getHttpServer())
      .get('/identity/ping')
      .set('x-request-id', customId)
      .expect(200);

    expect(downstream.lastRequest?.headers['x-request-id']).toBe(customId);
  });

  it('generates x-request-id when missing', async () => {
    const res = await request(app.getHttpServer()).get('/identity/ping').expect(200);

    const responseRequestId = res.headers['x-request-id'];
    expect(responseRequestId).toBeDefined();
    expect(typeof responseRequestId).toBe('string');
    expect(responseRequestId.length).toBeGreaterThan(0);

    expect(downstream.lastRequest?.headers['x-request-id']).toBe(responseRequestId);
  });

  it('forwards query params', async () => {
    await request(app.getHttpServer()).get('/identity/search?q=hello&page=2').expect(200);

    expect(downstream.lastRequest?.url).toBe('/search?q=hello&page=2');
  });

  it('forwards authorization header', async () => {
    await request(app.getHttpServer())
      .get('/identity/me')
      .set('authorization', 'Bearer token123')
      .expect(200);

    expect(downstream.lastRequest?.headers['authorization']).toBe('Bearer token123');
  });
});
