import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export class RefreshBodyDto {
  @ApiProperty({ example: 'dGhpcyBpcyBhIHJlZnJlc2g...' })
  refreshToken!: string;
}

export class RefreshResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken!: string;

  @ApiProperty({ example: 'bmV3LXJlZnJlc2gtdG9rZW4...' })
  refreshToken!: string;

  @ApiProperty({ example: 900 })
  expiresInSec!: number;
}
