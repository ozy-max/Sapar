import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { resetEnvCache } from '../../src/config/env';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    resetEnvCache();
    const ctx: TestContext = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 { status: "ok" }', async () => {
      const res = await request(app.getHttpServer()).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /ready', () => {
    it('should return 200 when DB is reachable', async () => {
      const res = await request(app.getHttpServer()).get('/ready');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });
});
