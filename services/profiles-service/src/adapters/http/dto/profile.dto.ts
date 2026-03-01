import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(1, 'displayName is required')
    .max(100, 'displayName must be at most 100 characters'),
  avatarUrl: z.string().url('avatarUrl must be a valid URL').max(2048).nullish(),
  bio: z.string().max(500, 'bio must be at most 500 characters').nullish(),
  city: z.string().max(100, 'city must be at most 100 characters').nullish(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export class UpdateProfileBodyDto {
  @ApiProperty({ example: 'Алмат Касымов' })
  displayName!: string;

  @ApiPropertyOptional({ example: 'https://cdn.sapar.kg/avatars/1.jpg' })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ example: 'Опытный водитель, 5 лет стажа' })
  bio?: string | null;

  @ApiPropertyOptional({ example: 'Бишкек' })
  city?: string | null;
}

export class ProfileResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  userId!: string;

  @ApiProperty({ example: 'Алмат Касымов' })
  displayName!: string;

  @ApiPropertyOptional({ example: 'https://cdn.sapar.kg/avatars/1.jpg' })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ example: 'Опытный водитель' })
  bio?: string | null;

  @ApiPropertyOptional({ example: 'Бишкек' })
  city?: string | null;

  @ApiProperty({ example: 4.7 })
  ratingAvg!: number;

  @ApiProperty({ example: 23 })
  ratingCount!: number;
}
