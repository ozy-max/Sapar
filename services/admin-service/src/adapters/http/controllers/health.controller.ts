import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../db/prisma.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe (no dependencies)' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (checks DB)' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  @ApiResponse({ status: 503, description: 'Database is not reachable' })
  async ready(): Promise<{ status: string }> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 3000)),
      ]);
      return { status: 'ok' };
    } catch {
      throw new HttpException(
        { code: 'SERVICE_UNAVAILABLE', message: 'Database is not reachable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
