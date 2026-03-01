import { Controller, Get, Query, Headers } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { handleTripsSearch } from './trips-search.handler';
import { TripsSearchResponseDto, BffErrorDto } from '../dto/bff.dto';

@ApiTags('BFF v1 — Trips')
@Controller('v1/trips')
export class TripsSearchController {
  @Get('search')
  @ApiOperation({ summary: 'Search trips (passenger, public)' })
  @ApiQuery({ name: 'fromCity', required: true, example: 'Бишкек' })
  @ApiQuery({ name: 'toCity', required: true, example: 'Ош' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'minSeats', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: TripsSearchResponseDto })
  @ApiResponse({ status: 502, type: BffErrorDto })
  @ApiResponse({ status: 504, type: BffErrorDto })
  async search(
    @Query('fromCity') fromCity: string,
    @Query('toCity') toCity: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('minSeats') minSeatsStr?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<TripsSearchResponseDto> {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(offsetStr ?? '0', 10) || 0, 0);
    const minSeats = Math.max(parseInt(minSeatsStr ?? '1', 10) || 1, 1);
    const tid = traceId ?? 'unknown';

    return handleTripsSearch({
      params: { fromCity, toCity, dateFrom, dateTo, minSeats, limit, offset },
      headers: { 'x-request-id': tid },
      traceId: tid,
    });
  }
}
