import { Controller, Get, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { handleBookingDetails } from './booking-details.handler';
import { BookingDetailsResponseDto, BffErrorDto } from '../dto/bff.dto';

@ApiTags('BFF v1 — Bookings')
@Controller('v1/bookings')
export class BookingDetailsController {
  @Get(':bookingId')
  @ApiOperation({ summary: 'Booking details screen (aggregated: booking + payment)' })
  @ApiParam({ name: 'bookingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: BookingDetailsResponseDto })
  @ApiResponse({ status: 404, type: BffErrorDto })
  @ApiResponse({ status: 502, type: BffErrorDto })
  @ApiResponse({ status: 504, type: BffErrorDto })
  async getDetails(
    @Param('bookingId') bookingId: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<BookingDetailsResponseDto> {
    const tid = traceId ?? 'unknown';
    return handleBookingDetails({
      bookingId,
      headers: { 'x-request-id': tid },
      traceId: tid,
    });
  }
}
