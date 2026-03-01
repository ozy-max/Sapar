import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { registry } from './metrics.registry';

@ApiExcludeController()
@Controller()
export class MetricsController {
  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  }
}
