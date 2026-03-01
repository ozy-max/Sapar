import { Controller, Get, Query, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { handleTripsSearch } from './trips-search.handler';
import { TripsSearchResponseDto, BffErrorDto } from '../dto/bff.dto';

const searchQuerySchema = z.object({
  fromCity: z.string().min(1).max(100),
  toCity: z.string().min(1).max(100),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
  minSeats: z.coerce.number().int().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

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
    const parsed = searchQuerySchema.safeParse({
      fromCity,
      toCity,
      dateFrom,
      dateTo,
      minSeats: minSeatsStr,
      limit: limitStr,
      offset: offsetStr,
    });

    if (!parsed.success) {
      throw new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: parsed.error.flatten().fieldErrors,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const { data } = parsed;
    const limit = data.limit ?? 20;
    const offset = data.offset ?? 0;
    const minSeats = data.minSeats ?? 1;
    const tid = traceId ?? 'unknown';

    return handleTripsSearch({
      params: {
        fromCity: data.fromCity,
        toCity: data.toCity,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        minSeats,
        limit,
        offset,
      },
      headers: { 'x-request-id': tid },
      traceId: tid,
    });
  }
}
