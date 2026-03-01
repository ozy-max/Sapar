import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

const IDENTITY_PORT = 19031;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = `http://127.0.0.1:${IDENTITY_PORT}`;
  process.env['TRIPS_BASE_URL'] = 'http://127.0.0.1:19032';
  process.env['PAYMENTS_BASE_URL'] = 'http://127.0.0.1:19033';
  process.env['HTTP_TIMEOUT_MS'] = '500';
  process.env['MAX_BODY_BYTES'] = '1048576';
  resetEnvCache();
  resetSharedDispatcher();
});

describe('Proxy Timeout', () => {
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

  it('returns 504 when downstream times out', async () => {
    downstream.handler = (_req, _res) => {
      // intentionally never respond
    };

    const res = await request(app.getHttpServer())
      .get('/identity/slow')
      .set('x-request-id', 'timeout-trace-1')
      .expect(504);

    expect(res.body).toMatchObject({
      code: 'DOWNSTREAM_TIMEOUT',
      message: expect.any(String),
      traceId: 'timeout-trace-1',
    });
  });
});
