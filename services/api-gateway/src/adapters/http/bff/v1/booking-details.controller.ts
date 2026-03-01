import {
  Controller,
  Get,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { handleBookingDetails } from './booking-details.handler';
import { BookingDetailsResponseDto, BffErrorDto } from '../dto/bff.dto';

@ApiTags('BFF v1 — Bookings')
@Controller('v1/bookings')
export class BookingDetailsController {
  @Get(':bookingId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Booking details screen (aggregated: booking + payment)' })
  @ApiParam({ name: 'bookingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: BookingDetailsResponseDto })
  @ApiResponse({ status: 401, type: BffErrorDto })
  @ApiResponse({ status: 404, type: BffErrorDto })
  @ApiResponse({ status: 502, type: BffErrorDto })
  @ApiResponse({ status: 504, type: BffErrorDto })
  async getDetails(
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Headers('x-request-id') traceId?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<BookingDetailsResponseDto> {
    // Gateway-level Bearer presence check only.
    // JWT signature verification is performed by downstream services.
    // This check prevents clearly unauthenticated requests from reaching downstream.
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tid = traceId ?? 'unknown';
    return handleBookingDetails({
      bookingId,
      headers: { 'x-request-id': tid, authorization },
      traceId: tid,
    });
  }
}
