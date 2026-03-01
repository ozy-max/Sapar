import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const upsertConfigSchema = z
  .object({
    type: z.enum(['INT', 'FLOAT', 'BOOL', 'STRING', 'JSON']),
    value: z.unknown(),
    description: z.string().optional(),
    scope: z.string().optional(),
    constraints: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    switch (data.type) {
      case 'INT':
        if (typeof data.value !== 'number' || !Number.isInteger(data.value)) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be an integer' });
          return;
        }
        if (data.constraints?.min !== undefined && data.value < data.constraints.min) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: `Value must be >= ${data.constraints.min}` });
        }
        if (data.constraints?.max !== undefined && data.value > data.constraints.max) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: `Value must be <= ${data.constraints.max}` });
        }
        break;
      case 'FLOAT':
        if (typeof data.value !== 'number') {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be a number' });
          return;
        }
        if (data.constraints?.min !== undefined && data.value < data.constraints.min) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: `Value must be >= ${data.constraints.min}` });
        }
        if (data.constraints?.max !== undefined && data.value > data.constraints.max) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: `Value must be <= ${data.constraints.max}` });
        }
        break;
      case 'BOOL':
        if (typeof data.value !== 'boolean') {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be a boolean' });
        }
        break;
      case 'STRING':
        if (typeof data.value !== 'string') {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be a string' });
        }
        break;
      case 'JSON':
        break;
    }
  });

export type UpsertConfigInput = z.infer<typeof upsertConfigSchema>;

export class UpsertConfigBodyDto {
  @ApiProperty({ example: 'INT', enum: ['INT', 'FLOAT', 'BOOL', 'STRING', 'JSON'] })
  type!: string;

  @ApiProperty({ example: 100 })
  value!: unknown;

  @ApiPropertyOptional({ example: 'Maximum retry count' })
  description?: string;

  @ApiPropertyOptional({ example: 'global' })
  scope?: string;

  @ApiPropertyOptional({ example: { min: 0, max: 1000 } })
  constraints?: { min?: number; max?: number };
}

export class ConfigResponseDto {
  @ApiProperty({ example: 'RECEIPT_RETRY_N' })
  key!: string;

  @ApiProperty({ example: 'INT' })
  type!: string;

  @ApiProperty({ example: 3 })
  value!: unknown;

  @ApiPropertyOptional({ example: 'Maximum receipt retry count', nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ example: 'global', nullable: true })
  scope!: string | null;
}
