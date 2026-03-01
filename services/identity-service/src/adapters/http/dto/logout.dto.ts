import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

export class LogoutBodyDto {
  @ApiProperty({ example: 'dGhpcyBpcyBhIHJlZnJlc2g...' })
  refreshToken!: string;
}
