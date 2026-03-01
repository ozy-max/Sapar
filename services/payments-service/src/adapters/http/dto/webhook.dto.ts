import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const webhookSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  pspIntentId: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

export type WebhookInput = z.infer<typeof webhookSchema>;

export class WebhookBodyDto {
  @ApiProperty({ example: 'evt_abc123' })
  eventId!: string;

  @ApiProperty({ example: 'hold.succeeded' })
  type!: string;

  @ApiProperty({ example: 'fake_hold_xxx' })
  pspIntentId!: string;

  @ApiProperty({ required: false })
  data?: Record<string, unknown>;
}
