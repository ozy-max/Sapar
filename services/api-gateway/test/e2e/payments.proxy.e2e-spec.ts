import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

const PAYMENTS_PORT = 19023;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = 'http://127.0.0.1:19021';
  process.env['TRIPS_BASE_URL'] = 'http://127.0.0.1:19022';
  process.env['PAYMENTS_BASE_URL'] = `http://127.0.0.1:${PAYMENTS_PORT}`;
  process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19005';
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['MAX_BODY_BYTES'] = '1048576';
  resetEnvCache();
  resetSharedDispatcher();
});

describe('Payments Proxy', () => {
  let app: INestApplication;
  let downstream: MockDownstream;

  beforeAll(async () => {
    downstream = await createMockDownstream(PAYMENTS_PORT);
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
      res.end(JSON.stringify({ service: 'payments', ok: true }));
    };
  });

  it('GET /payments/ping -> proxies to downstream', async () => {
    const res = await request(app.getHttpServer())
      .get('/payments/ping')
      .expect(200);

    expect(res.body).toEqual({ service: 'payments', ok: true });
    expect(downstream.lastRequest?.url).toBe('/ping');
  });

  it('POST /payments/charge -> proxies correctly', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ chargeId: 'ch_1' }));
    };

    const res = await request(app.getHttpServer())
      .post('/payments/charge')
      .send({ amount: 5000, currency: 'KZT' })
      .set('content-type', 'application/json')
      .expect(201);

    expect(res.body).toEqual({ chargeId: 'ch_1' });
  });

  it('preserves downstream structured error in details', async () => {
    downstream.handler = (_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 'INSUFFICIENT_FUNDS',
        message: 'Not enough balance',
      }));
    };

    const res = await request(app.getHttpServer())
      .post('/payments/charge')
      .send({ amount: 999999 })
      .set('content-type', 'application/json')
      .expect(422);

    expect(res.body).toHaveProperty('code', 'INSUFFICIENT_FUNDS');
  });
});
