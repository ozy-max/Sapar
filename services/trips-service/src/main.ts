import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from './adapters/http/middleware/request-id.middleware';
import { httpMetricsMiddleware } from './observability/http-metrics.middleware';
import { loadEnv } from './config/env';
import { closeRedisClient } from './adapters/redis/redis.client';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.use(json({ limit: '1mb' }));
  app.use(requestIdMiddleware);
  app.use(httpMetricsMiddleware);
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());

  if (env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Sapar Trips Service')
      .setDescription('Ride lifecycle management for Sapar')
      .setVersion('0.0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('swagger', app, document);
  }

  app.enableShutdownHooks();

  // Close Redis on shutdown; app.close() is handled by enableShutdownHooks()
  process.once('SIGTERM', () => void closeRedisClient());
  process.once('SIGINT', () => void closeRedisClient());

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
