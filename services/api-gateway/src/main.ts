import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from './adapters/http/middleware/request-id.middleware';
import { getRedisClient } from './adapters/redis/redis.client';
import { RateLimitService } from './adapters/http/ratelimit/ratelimit.service';
import { buildRateLimitPolicies } from './adapters/http/ratelimit/ratelimit.policy';
import { createRateLimitGuard } from './adapters/http/ratelimit/ratelimit.guard';
import { loadEnv } from './config/env';
import { httpMetricsMiddleware } from './observability/http-metrics.middleware';
import { PrometheusRateLimitMetrics } from './observability/ratelimit-metrics.impl';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const isWildcard = env.ALLOWED_ORIGINS.length === 1 && env.ALLOWED_ORIGINS[0] === '*';
  app.enableCors({
    origin: isWildcard ? '*' : env.ALLOWED_ORIGINS,
    credentials: !isWildcard,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 600,
  });

  app.use(json({ limit: env.MAX_BODY_BYTES }));
  app.use(requestIdMiddleware);
  app.use(httpMetricsMiddleware);

  if (env.REDIS_URL) {
    const redis = getRedisClient(env.REDIS_URL);
    const rateLimitService = new RateLimitService(redis, env.REDIS_TIMEOUT_MS);
    const policies = buildRateLimitPolicies(env);
    const metrics = new PrometheusRateLimitMetrics();
    app.use(createRateLimitGuard(policies, rateLimitService, metrics, env.TRUST_PROXY));
  }

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sapar API Gateway')
    .setDescription('Public edge API for the Sapar ride-sharing platform')
    .setVersion('0.0.1')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('swagger', app, document);

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
