import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { HealthController } from './adapters/http/health.controller';
import { PrismaService } from './adapters/db/prisma.service';
import { ProxyModule } from './adapters/http/proxy/proxy.module';
import { BffModule } from './adapters/http/bff/bff.module';
import { ObservabilityModule } from './observability/observability.module';
import { normalizeRoute } from './observability/route-normalizer';
import { loadEnv } from './config/env';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: loadEnv().LOG_LEVEL,
        transport: loadEnv().NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        genReqId: (req: IncomingMessage): string =>
          (req.headers['x-request-id'] as string) || randomUUID(),
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
          service: 'api-gateway',
          env: loadEnv().NODE_ENV,
          spanId: '',
          parentSpanId: '',
        }),
      },
    }),
    ProxyModule,
    BffModule,
    ObservabilityModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
