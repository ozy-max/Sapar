import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from './adapters/http/middleware/request-id.middleware';
import { httpMetricsMiddleware } from './observability/http-metrics.middleware';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(requestIdMiddleware);
  app.use(httpMetricsMiddleware);
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sapar Notifications Service')
    .setDescription('Notification processing for Sapar platform')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('swagger', app, document);

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
