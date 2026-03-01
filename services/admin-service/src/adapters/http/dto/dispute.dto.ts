import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const createDisputeSchema = z.object({
  type: z.enum(['NO_SHOW', 'OTHER']),
  bookingId: z.string().min(1),
  departAt: z.string().datetime(),
  evidenceUrls: z.array(z.string().url()).default([]),
});

export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const resolveDisputeSchema = z
  .object({
    resolution: z.enum(['REFUND', 'NO_REFUND', 'PARTIAL', 'BAN_USER']),
    refundAmountKgs: z.number().int().positive().optional(),
  })
  .refine((data) => data.resolution !== 'PARTIAL' || data.refundAmountKgs !== undefined, {
    message: 'refundAmountKgs is required for PARTIAL resolution',
    path: ['refundAmountKgs'],
  });

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export class CreateDisputeBodyDto {
  @ApiProperty({ example: 'NO_SHOW', enum: ['NO_SHOW', 'OTHER'] })
  type!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  bookingId!: string;

  @ApiProperty({ example: '2025-06-15T08:00:00.000Z' })
  departAt!: string;

  @ApiPropertyOptional({ example: ['https://example.com/photo.jpg'] })
  evidenceUrls?: string[];
}

export class ResolveDisputeBodyDto {
  @ApiProperty({
    example: 'REFUND',
    enum: ['REFUND', 'NO_REFUND', 'PARTIAL', 'BAN_USER'],
  })
  resolution!: string;

  @ApiPropertyOptional({
    example: 500,
    description: 'Required for PARTIAL resolution',
  })
  refundAmountKgs?: number;
}

export class DisputeResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'NO_SHOW' })
  type!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  bookingId!: string;

  @ApiProperty({ example: 'OPEN' })
  status!: string;

  @ApiPropertyOptional({ example: 'REFUND' })
  resolution?: string;
}
