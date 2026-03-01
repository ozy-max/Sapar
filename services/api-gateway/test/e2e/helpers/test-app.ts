import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from '../../../src/app.module';
import { AllExceptionsFilter } from '../../../src/adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../../../src/adapters/http/middleware/request-id.middleware';
import { getRedisClient } from '../../../src/adapters/redis/redis.client';
import { RateLimitService } from '../../../src/adapters/http/ratelimit/ratelimit.service';
import { buildRateLimitPolicies } from '../../../src/adapters/http/ratelimit/ratelimit.policy';
import { NoopRateLimitMetrics } from '../../../src/adapters/http/ratelimit/metrics';
import { createRateLimitGuard } from '../../../src/adapters/http/ratelimit/ratelimit.guard';
import { loadEnv } from '../../../src/config/env';

export async function createTestApp(): Promise<INestApplication> {
  const env = loadEnv();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(json({ limit: env.MAX_BODY_BYTES }));
  app.use(requestIdMiddleware);

  if (env.REDIS_URL) {
    const redis = getRedisClient(env.REDIS_URL);
    const rateLimitService = new RateLimitService(redis, env.REDIS_TIMEOUT_MS);
    const policies = buildRateLimitPolicies(env);
    const metrics = new NoopRateLimitMetrics();
    app.use(createRateLimitGuard(policies, rateLimitService, metrics, env.TRUST_PROXY));
  }

  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
