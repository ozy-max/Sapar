import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

const TRIPS_PORT = 19012;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = 'http://127.0.0.1:19011';
  process.env['TRIPS_BASE_URL'] = `http://127.0.0.1:${TRIPS_PORT}`;
  process.env['PAYMENTS_BASE_URL'] = 'http://127.0.0.1:19013';
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['MAX_BODY_BYTES'] = '1048576';
  resetEnvCache();
  resetSharedDispatcher();
});

describe('Trips Proxy', () => {
  let app: INestApplication;
  let downstream: MockDownstream;

  beforeAll(async () => {
    downstream = await createMockDownstream(TRIPS_PORT);
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
      res.end(JSON.stringify({ service: 'trips', ok: true }));
    };
  });

  it('GET /trips/ping -> proxies to downstream', async () => {
    const res = await request(app.getHttpServer())
      .get('/trips/ping')
      .expect(200);

    expect(res.body).toEqual({ service: 'trips', ok: true });
    expect(downstream.lastRequest?.url).toBe('/ping');
  });

  it('PUT /trips/123 -> proxies correctly', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ updated: true }));
    };

    const res = await request(app.getHttpServer())
      .put('/trips/123')
      .send({ destination: 'Almaty' })
      .set('content-type', 'application/json')
      .expect(200);

    expect(res.body).toEqual({ updated: true });
    expect(downstream.lastRequest?.method).toBe('PUT');
    expect(downstream.lastRequest?.url).toBe('/123');
  });

  it('PATCH /trips/123/status -> proxies correctly', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ patched: true }));
    };

    await request(app.getHttpServer())
      .patch('/trips/123/status')
      .send({ status: 'active' })
      .set('content-type', 'application/json')
      .expect(200);

    expect(downstream.lastRequest?.method).toBe('PATCH');
    expect(downstream.lastRequest?.url).toBe('/123/status');
  });

  it('DELETE /trips/456 -> proxies correctly', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(204);
      res.end();
    };

    await request(app.getHttpServer())
      .delete('/trips/456')
      .expect(204);

    expect(downstream.lastRequest?.method).toBe('DELETE');
    expect(downstream.lastRequest?.url).toBe('/456');
  });
});
