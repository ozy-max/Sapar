import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const searchTripsSchema = z.object({
  fromCity: z.string().min(1),
  toCity: z.string().min(1),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  minSeats: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type SearchTripsInput = z.infer<typeof searchTripsSchema>;

export class SearchTripsQueryDto {
  @ApiProperty({ example: 'Алматы' })
  fromCity!: string;

  @ApiProperty({ example: 'Астана' })
  toCity!: string;

  @ApiPropertyOptional({ example: '2025-06-15T00:00:00.000Z' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2025-06-16T00:00:00.000Z' })
  dateTo?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  minSeats?: number;

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
