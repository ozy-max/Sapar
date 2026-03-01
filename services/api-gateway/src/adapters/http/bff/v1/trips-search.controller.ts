import { Controller, Get, Query, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { handleTripsSearch } from './trips-search.handler';
import { TripsSearchResponseDto, BffErrorDto } from '../dto/bff.dto';

const searchQuerySchema = z
  .object({
    fromCity: z.string().min(1).max(100).optional(),
    toCity: z.string().min(1).max(100).optional(),
    fromCityId: z.string().uuid().optional(),
    toCityId: z.string().uuid().optional(),
    fromLat: z.coerce.number().min(-90).max(90).optional(),
    fromLon: z.coerce.number().min(-180).max(180).optional(),
    toLat: z.coerce.number().min(-90).max(90).optional(),
    toLon: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(500).optional(),
    bboxMinLat: z.coerce.number().min(-90).max(90).optional(),
    bboxMinLon: z.coerce.number().min(-180).max(180).optional(),
    bboxMaxLat: z.coerce.number().min(-90).max(90).optional(),
    bboxMaxLon: z.coerce.number().min(-180).max(180).optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional(),
    minSeats: z.coerce.number().int().min(1).max(50).optional(),
    priceMin: z.coerce.number().int().nonnegative().optional(),
    priceMax: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (d) => d.fromCity || d.fromCityId || d.fromLat != null || d.bboxMinLat != null,
    { message: 'At least one location filter required', path: ['fromCity'] },
  );

@ApiTags('BFF v1 — Trips')
@Controller('v1/trips')
export class TripsSearchController {
  @Get('search')
  @ApiOperation({ summary: 'Search trips (passenger, public, geo-aware)' })
  @ApiQuery({ name: 'fromCity', required: false, example: 'Бишкек', description: 'Deprecated: use fromCityId' })
  @ApiQuery({ name: 'toCity', required: false, example: 'Ош', description: 'Deprecated: use toCityId' })
  @ApiQuery({ name: 'fromCityId', required: false })
  @ApiQuery({ name: 'toCityId', required: false })
  @ApiQuery({ name: 'fromLat', required: false, example: 42.8746 })
  @ApiQuery({ name: 'fromLon', required: false, example: 74.5698 })
  @ApiQuery({ name: 'toLat', required: false })
  @ApiQuery({ name: 'toLon', required: false })
  @ApiQuery({ name: 'radiusKm', required: false, example: 25 })
  @ApiQuery({ name: 'bboxMinLat', required: false })
  @ApiQuery({ name: 'bboxMinLon', required: false })
  @ApiQuery({ name: 'bboxMaxLat', required: false })
  @ApiQuery({ name: 'bboxMaxLon', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'minSeats', required: false, example: 1 })
  @ApiQuery({ name: 'priceMin', required: false })
  @ApiQuery({ name: 'priceMax', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: TripsSearchResponseDto })
  @ApiResponse({ status: 502, type: BffErrorDto })
  @ApiResponse({ status: 504, type: BffErrorDto })
  async search(
    @Query() rawQuery: Record<string, string>,
    @Headers('x-request-id') traceId?: string,
  ): Promise<TripsSearchResponseDto> {
    const parsed = searchQuerySchema.safeParse(rawQuery);

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
        fromCityId: data.fromCityId,
        toCityId: data.toCityId,
        fromLat: data.fromLat,
        fromLon: data.fromLon,
        toLat: data.toLat,
        toLon: data.toLon,
        radiusKm: data.radiusKm,
        bboxMinLat: data.bboxMinLat,
        bboxMinLon: data.bboxMinLon,
        bboxMaxLat: data.bboxMaxLat,
        bboxMaxLon: data.bboxMaxLon,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        minSeats,
        priceMin: data.priceMin,
        priceMax: data.priceMax,
        limit,
        offset,
      },
      headers: { 'x-request-id': tid },
      traceId: tid,
    });
  }
}
