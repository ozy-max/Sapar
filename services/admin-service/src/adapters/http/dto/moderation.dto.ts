import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const banUserSchema = z.object({
  reason: z.string().min(1).max(1000),
  until: z.string().datetime().optional(),
});

export type BanUserInput = z.infer<typeof banUserSchema>;

export const unbanUserSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type UnbanUserInput = z.infer<typeof unbanUserSchema>;

export const cancelTripSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type CancelTripInput = z.infer<typeof cancelTripSchema>;

export class BanUserBodyDto {
  @ApiProperty({ example: 'Repeated no-show violations' })
  reason!: string;

  @ApiPropertyOptional({ example: '2025-07-15T00:00:00.000Z' })
  until?: string;
}

export class UnbanUserBodyDto {
  @ApiProperty({ example: 'Ban period expired, user contacted support' })
  reason!: string;
}

export class CancelTripBodyDto {
  @ApiProperty({ example: 'Driver reported fraudulent listing' })
  reason!: string;
}

export class ModerationCommandResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  commandId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;
}
