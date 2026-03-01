import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const searchTripsSchema = z
  .object({
    fromCity: z.string().min(1).optional(),
    toCity: z.string().min(1).optional(),
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
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    minSeats: z.coerce.number().int().positive().default(1),
    priceMin: z.coerce.number().int().nonnegative().optional(),
    priceMax: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .refine(
    (d) => d.fromCity || d.fromCityId || d.fromLat != null || d.bboxMinLat != null,
    { message: 'At least one location filter is required (fromCity, fromCityId, fromLat, or bboxMinLat)', path: ['fromCity'] },
  );

export type SearchTripsInput = z.infer<typeof searchTripsSchema>;

export class SearchTripsQueryDto {
  @ApiPropertyOptional({ example: 'Бишкек', description: 'Departure city name (deprecated, use fromCityId)' })
  fromCity?: string;

  @ApiPropertyOptional({ example: 'Ош', description: 'Arrival city name (deprecated, use toCityId)' })
  toCity?: string;

  @ApiPropertyOptional({ description: 'Departure city UUID' })
  fromCityId?: string;

  @ApiPropertyOptional({ description: 'Arrival city UUID' })
  toCityId?: string;

  @ApiPropertyOptional({ example: 42.8746, description: 'Departure latitude' })
  fromLat?: number;

  @ApiPropertyOptional({ example: 74.5698, description: 'Departure longitude' })
  fromLon?: number;

  @ApiPropertyOptional({ example: 40.5283, description: 'Arrival latitude' })
  toLat?: number;

  @ApiPropertyOptional({ example: 72.7985, description: 'Arrival longitude' })
  toLon?: number;

  @ApiPropertyOptional({ example: 25, description: 'Radius in km (default 25)' })
  radiusKm?: number;

  @ApiPropertyOptional({ description: 'Bounding box min latitude' })
  bboxMinLat?: number;

  @ApiPropertyOptional({ description: 'Bounding box min longitude' })
  bboxMinLon?: number;

  @ApiPropertyOptional({ description: 'Bounding box max latitude' })
  bboxMaxLat?: number;

  @ApiPropertyOptional({ description: 'Bounding box max longitude' })
  bboxMaxLon?: number;

  @ApiPropertyOptional({ example: '2025-06-15T00:00:00.000Z' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2025-06-16T00:00:00.000Z' })
  dateTo?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  minSeats?: number;

  @ApiPropertyOptional({ description: 'Minimum price filter' })
  priceMin?: number;

  @ApiPropertyOptional({ description: 'Maximum price filter' })
  priceMax?: number;

  @ApiPropertyOptional({ example: 50, default: 50 })
  limit?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  offset?: number;
}

export class SearchTripItemDto {
  @ApiProperty() tripId!: string;
  @ApiProperty() driverId!: string;
  @ApiProperty() fromCity!: string;
  @ApiProperty() toCity!: string;
  @ApiPropertyOptional({ nullable: true }) fromCityId!: string | null;
  @ApiPropertyOptional({ nullable: true }) toCityId!: string | null;
  @ApiProperty() departAt!: string;
  @ApiProperty() seatsTotal!: number;
  @ApiProperty() seatsAvailable!: number;
  @ApiProperty() priceKgs!: number;
  @ApiProperty() status!: string;
}

export class SearchTripsResponseDto {
  @ApiProperty({ type: [SearchTripItemDto] })
  items!: SearchTripItemDto[];

  @ApiProperty({ example: 1 })
  count!: number;
}
