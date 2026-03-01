import { PipeTransform, Injectable } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { ValidationError } from '../../../shared/errors';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      throw new ValidationError({ fields: fieldErrors });
    }
    return result.data;
  }
}
