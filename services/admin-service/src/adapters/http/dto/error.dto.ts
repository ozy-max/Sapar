import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({ example: { fields: { key: ['Required'] } } })
  details?: Record<string, unknown>;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  traceId!: string;
}
