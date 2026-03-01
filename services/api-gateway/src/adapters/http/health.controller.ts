import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../db/prisma.service';
import { getRedisInstance } from '../redis/redis.client';

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
  @ApiOperation({ summary: 'Readiness probe — checks database and Redis connectivity' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready (DB or Redis unreachable)' })
  async getReady(): Promise<{ status: string }> {
    const isDbReady = await this.prisma.checkConnection();

    let isRedisReady = true;
    try {
      const redis = getRedisInstance();
      if (redis) {
        const pong = await Promise.race([
          redis.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Redis ping timeout')), 1000),
          ),
        ]);
        isRedisReady = pong === 'PONG';
      }
    } catch {
      isRedisReady = false;
    }

    if (!isDbReady || !isRedisReady) {
      const reasons: string[] = [];
      if (!isDbReady) reasons.push('database');
      if (!isRedisReady) reasons.push('redis');
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: `Not reachable: ${reasons.join(', ')}`,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ready' };
  }
}
