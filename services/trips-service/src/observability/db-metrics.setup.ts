import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { dbQueryDurationMs, dbErrorsTotal } from './metrics.registry';

@Injectable()
export class DbMetricsSetup implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.prisma.$use(async (params, next) => {
      const start = performance.now();
      try {
        const result = await next(params);
        dbQueryDurationMs.labels(params.action).observe(performance.now() - start);
        return result;
      } catch (error) {
        dbQueryDurationMs.labels(params.action).observe(performance.now() - start);
        dbErrorsTotal.labels(params.action).inc();
        throw error;
      }
    });
  }
}
