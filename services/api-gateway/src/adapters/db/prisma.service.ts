import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';

const DB_CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PrismaService.name);
    this.client = new PrismaClient();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.info('Connected to database');
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Initial database connection failed — readiness probe will report not ready',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async checkConnection(timeoutMs: number = DB_CHECK_TIMEOUT_MS): Promise<boolean> {
    try {
      await Promise.race([
        this.client.$queryRawUnsafe('SELECT 1'),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('DB health check timeout')), timeoutMs),
        ),
      ]);
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Database readiness check failed');
      return false;
    }
  }
}
