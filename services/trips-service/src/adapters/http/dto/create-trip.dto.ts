import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const createTripSchema = z.object({
  fromCity: z.string().min(1).max(200),
  toCity: z.string().min(1).max(200),
  departAt: z.string().datetime(),
  seatsTotal: z.number().int().min(1).max(50),
  priceKgs: z.number().int().min(0),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;

export class CreateTripBodyDto {
  @ApiProperty({ example: 'Алматы' })
  fromCity!: string;

  @ApiProperty({ example: 'Астана' })
  toCity!: string;

  @ApiProperty({ example: '2025-06-15T08:00:00.000Z' })
  departAt!: string;

  @ApiProperty({ example: 4 })
  seatsTotal!: number;

  @ApiProperty({ example: 5000 })
  priceKgs!: number;
}

export class CreateTripResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  tripId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  driverId!: string;

  @ApiProperty({ example: 'Алматы' })
  fromCity!: string;

  @ApiProperty({ example: 'Астана' })
  toCity!: string;

  @ApiProperty({ example: '2025-06-15T08:00:00.000Z' })
  departAt!: string;

  @ApiProperty({ example: 4 })
  seatsTotal!: number;

  @ApiProperty({ example: 4 })
  seatsAvailable!: number;

  @ApiProperty({ example: 5000 })
  priceKgs!: number;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;
}
