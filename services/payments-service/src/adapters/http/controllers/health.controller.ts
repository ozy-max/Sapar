import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../db/prisma.service';
import { AppError } from '../../../shared/errors';

const READY_TIMEOUT_MS = 3_000;

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (checks DB)' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'DB unreachable' })
  async ready(): Promise<{ status: string }> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('DB health check timeout')), READY_TIMEOUT_MS),
        ),
      ]);
      return { status: 'ok' };
    } catch {
      throw new AppError('DB_UNAVAILABLE', 503, 'Database is not reachable');
    }
  }
}
