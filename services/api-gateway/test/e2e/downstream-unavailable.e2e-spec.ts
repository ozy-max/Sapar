import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = 'http://127.0.0.1:19041';
  process.env['TRIPS_BASE_URL'] = 'http://127.0.0.1:19042';
  process.env['PAYMENTS_BASE_URL'] = 'http://127.0.0.1:19043';
  process.env['HTTP_TIMEOUT_MS'] = '2000';
  process.env['MAX_BODY_BYTES'] = '1048576';
  resetEnvCache();
  resetSharedDispatcher();
});

describe('Downstream Unavailable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 502 when downstream is unreachable', async () => {
    const res = await request(app.getHttpServer())
      .get('/identity/ping')
      .set('x-request-id', 'unavail-trace-1')
      .expect(502);

    expect(res.body).toMatchObject({
      code: 'DOWNSTREAM_UNAVAILABLE',
      message: expect.any(String),
      traceId: 'unavail-trace-1',
    });
  });

  it('returns 502 for trips when downstream is unreachable', async () => {
    const res = await request(app.getHttpServer())
      .get('/trips/ping')
      .set('x-request-id', 'unavail-trace-2')
      .expect(502);

    expect(res.body).toMatchObject({
      code: 'DOWNSTREAM_UNAVAILABLE',
      traceId: 'unavail-trace-2',
    });
  });

  it('returns 502 for payments when downstream is unreachable', async () => {
    const res = await request(app.getHttpServer())
      .get('/payments/ping')
      .set('x-request-id', 'unavail-trace-3')
      .expect(502);

    expect(res.body).toMatchObject({
      code: 'DOWNSTREAM_UNAVAILABLE',
      traceId: 'unavail-trace-3',
    });
  });
});
