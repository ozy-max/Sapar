import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SharedModule } from './shared/shared.module';
import { DatabaseModule } from './adapters/db/database.module';
import { ConfigModule } from './adapters/http/config.module';
import { DisputeModule } from './adapters/http/dispute.module';
import { ModerationModule } from './adapters/http/moderation.module';
import { HealthController } from './adapters/http/controllers/health.controller';
import { ObservabilityModule } from './observability/observability.module';
import { normalizeRoute } from './observability/route-normalizer';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['NODE_ENV'] === 'test' ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
        genReqId: (req: IncomingMessage): string => {
          return (req.headers['x-request-id'] as string) ?? randomUUID();
        },
        serializers: {
          req(req: Record<string, unknown>): Record<string, unknown> {
            const url = (req['url'] as string) ?? '/';
            return { id: req['id'], method: req['method'], url, route: normalizeRoute(url) };
          },
          res(res: Record<string, unknown>): Record<string, unknown> {
            return { statusCode: res['statusCode'] };
          },
        },
        customProps: (req: IncomingMessage): Record<string, unknown> => ({
          traceId: req.headers['x-request-id'],
          service: 'admin-service',
          env: process.env['NODE_ENV'] ?? 'development',
          spanId: '',
          parentSpanId: '',
        }),
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    SharedModule,
    DatabaseModule,
    ConfigModule,
    DisputeModule,
    ModerationModule,
    ObservabilityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
