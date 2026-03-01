import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const createNotificationSchema = z.object({
  channel: z.enum(['SMS', 'EMAIL', 'PUSH']),
  templateKey: z.string().min(1, 'templateKey is required'),
  payload: z.record(z.unknown()).default({}),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

export class CreateNotificationBodyDto {
  @ApiProperty({ enum: ['SMS', 'EMAIL', 'PUSH'], example: 'EMAIL' })
  channel!: string;

  @ApiProperty({ example: 'BOOKING_CONFIRMED' })
  templateKey!: string;

  @ApiPropertyOptional({ example: { bookingId: 'abc-123', route: 'Bishkek → Osh' } })
  payload?: Record<string, unknown>;
}

export class EnqueueResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  notificationId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;
}

export class NotificationDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() channel!: string;
  @ApiProperty() templateKey!: string;
  @ApiProperty() status!: string;
  @ApiProperty() tryCount!: number;
  @ApiPropertyOptional() providerMessageId!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class CancelResponseDto {
  @ApiProperty() notificationId!: string;
  @ApiProperty({ example: 'CANCELLED' }) status!: string;
}
