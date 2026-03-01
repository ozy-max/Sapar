import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const createRatingSchema = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
  score: z.number().int().min(1, 'score must be at least 1').max(5, 'score must be at most 5'),
  comment: z.string().max(500, 'comment must be at most 500 characters').nullish(),
});

export type CreateRatingInput = z.infer<typeof createRatingSchema>;

export class CreateRatingBodyDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  bookingId!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  score!: number;

  @ApiPropertyOptional({ example: 'Отличный водитель!' })
  comment?: string | null;
}

export class RatingResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  tripId!: string;

  @ApiProperty({ example: 'PASSENGER_RATES_DRIVER' })
  role!: string;

  @ApiProperty({ example: 5 })
  score!: number;

  @ApiPropertyOptional({ example: 'Отличный водитель!' })
  comment?: string | null;

  @ApiProperty({ example: '2026-01-15T10:30:00.000Z' })
  createdAt!: string;
}

export class RatingsListResponseDto {
  @ApiProperty({ type: [RatingResponseDto] })
  items!: RatingResponseDto[];

  @ApiProperty({ example: 23 })
  total!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}
