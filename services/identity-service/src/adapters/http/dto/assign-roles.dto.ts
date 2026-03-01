import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const assignRolesSchema = z.object({
  roles: z.array(z.enum(['ADMIN', 'OPS', 'SUPPORT', 'DRIVER', 'PASSENGER'])).min(0),
});

export type AssignRolesInput = z.infer<typeof assignRolesSchema>;

export class AssignRolesBodyDto {
  @ApiProperty({ example: ['ADMIN', 'OPS'] })
  roles!: string[];
}

export class AssignRolesResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  userId!: string;

  @ApiProperty({ example: ['ADMIN', 'OPS'] })
  roles!: string[];
}
