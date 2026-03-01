import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/adapters/db/prisma.service';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    resetEnvCache();
    const ctx: TestContext = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  const testUser = { email: 'Test@Example.com', password: 'securepass123' };
  const normalizedEmail = 'test@example.com';

  async function registerUser(): Promise<request.Response> {
    return request(app.getHttpServer()).post('/auth/register').send(testUser);
  }

  async function loginUser(): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password });
  }

  describe('POST /auth/register', () => {
    it('should register a new user and return userId + email', async () => {
      const res = await registerUser();

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('userId');
      expect(res.body.email).toBe(normalizedEmail);
      expect(typeof res.body.userId).toBe('string');
    });

    it('should return 409 EMAIL_TAKEN for duplicate email', async () => {
      await registerUser();
      const res = await registerUser();

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
      expect(res.body).toHaveProperty('traceId');
    });

    it('should return 400 VALIDATION_ERROR for invalid input', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body).toHaveProperty('details');
    });

    it('should return 400 for password exceeding 128 characters', async () => {
      const longPassword = 'a'.repeat(129);
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'longpass@example.com', password: longPassword });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body).toHaveProperty('details');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await registerUser();
    });

    it('should login and return tokens', async () => {
      const res = await loginUser();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('expiresInSec');
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
      expect(typeof res.body.expiresInSec).toBe('number');
    });

    it('should return 401 INVALID_CREDENTIALS for wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect(res.body).toHaveProperty('traceId');
    });

    it('should return 401 INVALID_CREDENTIALS for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'somepassword' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      await registerUser();
      const loginRes = await loginUser();
      refreshToken = loginRes.body.refreshToken;
    });

    it('should rotate refresh token and return new tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('expiresInSec');
      expect(res.body.refreshToken).not.toBe(refreshToken);
    });

    it('should invalidate old refresh token after rotation', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should return 401 for invalid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'totally-invalid-token' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should revoke all user tokens on reuse of already-revoked token (reuse detection)', async () => {
      const rotated = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(rotated.status).toBe(200);
      const newRefreshToken = rotated.body.refreshToken;

      // Reuse the old (now revoked) token — triggers reuse detection
      const reuse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(reuse.status).toBe(401);
      expect(reuse.body.code).toBe('INVALID_REFRESH_TOKEN');

      // The new token should also be invalidated (family revocation)
      const familyRevoked = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: newRefreshToken });
      expect(familyRevoked.status).toBe(401);
      expect(familyRevoked.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should include X-RateLimit headers on refresh response', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });

  describe('POST /auth/logout', () => {
    let refreshToken: string;

    beforeEach(async () => {
      await registerUser();
      const loginRes = await loginUser();
      refreshToken = loginRes.body.refreshToken;
    });

    it('should invalidate refresh token and return 204', async () => {
      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });

      expect(logoutRes.status).toBe(204);

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should return 204 even for already-invalid token (idempotent)', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });

      expect(res.status).toBe(204);
    });
  });

  describe('traceId propagation', () => {
    it('should return traceId equal to x-request-id in error responses', async () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-request-id', requestId)
        .send({ email: 'nobody@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.traceId).toBe(requestId);
      expect(res.headers['x-request-id']).toBe(requestId);
    });
  });
});
