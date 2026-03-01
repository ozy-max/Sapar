import { Controller, Get, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { handleTripDetails } from './trip-details.handler';
import { TripDetailsResponseDto, BffErrorDto } from '../dto/bff.dto';

@ApiTags('BFF v1 — Trips')
@Controller('v1/trips')
export class TripDetailsController {
  @Get(':tripId')
  @ApiOperation({ summary: 'Trip details screen (aggregated)' })
  @ApiParam({ name: 'tripId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: TripDetailsResponseDto })
  @ApiResponse({ status: 404, type: BffErrorDto })
  @ApiResponse({ status: 502, type: BffErrorDto })
  @ApiResponse({ status: 504, type: BffErrorDto })
  async getDetails(
    @Param('tripId') tripId: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<TripDetailsResponseDto> {
    const tid = traceId ?? 'unknown';
    return handleTripDetails({
      tripId,
      headers: { 'x-request-id': tid },
      traceId: tid,
    });
  }
}
