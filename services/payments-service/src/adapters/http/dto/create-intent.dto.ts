import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const createIntentSchema = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
  amountKgs: z.number().int().positive('amountKgs must be a positive integer'),
});

export type CreateIntentInput = z.infer<typeof createIntentSchema>;

export class CreateIntentBodyDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  bookingId!: string;

  @ApiProperty({ example: 1500, description: 'Amount in KGS (tiyins)' })
  amountKgs!: number;
}

export class CreateIntentResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  paymentIntentId!: string;

  @ApiProperty({ example: 'HOLD_PLACED' })
  status!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  bookingId!: string;
}

export class StatusResponseDto {
  @ApiProperty({ example: 'CAPTURED' })
  status!: string;
}
