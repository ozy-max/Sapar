import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../../src/adapters/db/prisma.service';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';

function signToken(userId: string, email: string, roles: string[]): string {
  return jwt.sign({ sub: userId, email, roles }, JWT_SECRET, { expiresIn: 3600 });
}

describe('Admin — Role assignment (e2e)', () => {
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

  const testUser = { email: 'admin@example.com', password: 'securepass123' };
  const targetUser = { email: 'target@example.com', password: 'securepass123' };

  async function registerUser(user: { email: string; password: string }): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(user);
    return res.body.userId;
  }

  describe('POST /admin/users/:userId/roles', () => {
    it('should assign roles to a user (ADMIN only)', async () => {
      const adminId = await registerUser(testUser);
      const targetId = await registerUser(targetUser);

      await prisma.user.update({ where: { id: adminId }, data: { roles: ['ADMIN'] } });

      const adminToken = signToken(adminId, testUser.email, ['ADMIN']);

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: ['OPS', 'SUPPORT'] });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(targetId);
      expect(res.body.roles).toEqual(['OPS', 'SUPPORT']);
    });

    it('should return 403 for non-ADMIN user', async () => {
      const userId = await registerUser(testUser);
      const targetId = await registerUser(targetUser);

      await prisma.user.update({ where: { id: userId }, data: { roles: ['OPS'] } });

      const opsToken = signToken(userId, testUser.email, ['OPS']);

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetId}/roles`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ roles: ['ADMIN'] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should return 401 without token', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/users/00000000-0000-4000-a000-000000000001/roles')
        .send({ roles: ['ADMIN'] });

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent user', async () => {
      const adminId = await registerUser(testUser);
      await prisma.user.update({ where: { id: adminId }, data: { roles: ['ADMIN'] } });
      const adminToken = signToken(adminId, testUser.email, ['ADMIN']);

      const res = await request(app.getHttpServer())
        .post('/admin/users/00000000-0000-4000-a000-ffffffffffff/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: ['OPS'] });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('Login token contains roles', () => {
    it('should include roles claim in access token after role assignment', async () => {
      const userId = await registerUser(testUser);

      await prisma.user.update({ where: { id: userId }, data: { roles: ['ADMIN'] } });

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send(testUser);

      expect(loginRes.status).toBe(200);

      const decoded = jwt.verify(loginRes.body.accessToken, JWT_SECRET) as {
        sub: string;
        email: string;
        roles: string[];
      };

      expect(decoded.roles).toEqual(['ADMIN']);
    });

    it('should include updated roles after refresh', async () => {
      const userId = await registerUser(testUser);
      await prisma.user.update({ where: { id: userId }, data: { roles: ['SUPPORT'] } });

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send(testUser);

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken });

      expect(refreshRes.status).toBe(200);

      const decoded = jwt.verify(refreshRes.body.accessToken, JWT_SECRET) as {
        sub: string;
        roles: string[];
      };

      expect(decoded.roles).toEqual(['SUPPORT']);
    });
  });
});
