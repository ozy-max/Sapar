import { Controller, Get, Query, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { handleMyBookings } from './my-bookings.handler';
import { MyBookingsResponseDto, BffErrorDto } from '../dto/bff.dto';

const VALID_BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'] as const;

@ApiTags('BFF v1 — My Bookings')
@Controller('v1/me')
export class MyBookingsController {
  @Get('bookings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My bookings list (JWT required, aggregated with payment status)' })
  @ApiQuery({ name: 'status', required: false, example: 'CONFIRMED' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: MyBookingsResponseDto })
  @ApiResponse({ status: 401, type: BffErrorDto })
  @ApiResponse({ status: 502, type: BffErrorDto })
  @ApiResponse({ status: 504, type: BffErrorDto })
  async list(
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Headers('x-request-id') traceId?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<MyBookingsResponseDto> {
    // Gateway-level Bearer presence check only.
    // JWT signature verification is performed by downstream services.
    // This check prevents clearly unauthenticated requests from reaching downstream.
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (status && !(VALID_BOOKING_STATUSES as readonly string[]).includes(status)) {
      throw new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: `Invalid status. Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const limit = Math.min(Math.max(parseInt(limitStr ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(offsetStr ?? '0', 10) || 0, 0);
    const tid = traceId ?? 'unknown';

    const headers: Record<string, string> = { 'x-request-id': tid };
    if (authorization) {
      headers['authorization'] = authorization;
    }

    return handleMyBookings({
      status,
      limit,
      offset,
      headers,
      traceId: tid,
    });
  }
}
