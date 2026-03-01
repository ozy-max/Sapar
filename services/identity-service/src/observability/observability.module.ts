import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { DbMetricsSetup } from './db-metrics.setup';

@Module({
  controllers: [MetricsController],
  providers: [DbMetricsSetup],
})
export class ObservabilityModule {}
