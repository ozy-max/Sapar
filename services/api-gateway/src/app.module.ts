import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { HealthController } from './adapters/http/health.controller';
import { PrismaService } from './adapters/db/prisma.service';
import { ProxyModule } from './adapters/http/proxy/proxy.module';
import { loadEnv } from './config/env';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: loadEnv().LOG_LEVEL,
        transport:
          loadEnv().NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
      },
    }),
    ProxyModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
