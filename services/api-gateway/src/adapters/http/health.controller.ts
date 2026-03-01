import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../db/prisma.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks database connectivity' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready (DB unreachable)' })
  async getReady(): Promise<{ status: string }> {
    const isReady = await this.prisma.checkConnection();

    if (!isReady) {
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database is not reachable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ready' };
  }
}
