import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const bookSeatSchema = z.object({
  seats: z.number().int().min(1).max(50).default(1),
});

export type BookSeatInput = z.infer<typeof bookSeatSchema>;

export class BookSeatBodyDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  seats?: number;
}

export class BookSeatResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440002' })
  bookingId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  tripId!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;
}
