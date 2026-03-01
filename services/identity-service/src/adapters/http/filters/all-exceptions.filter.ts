import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from '../../../shared/errors';

interface UnifiedError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = (request.headers['x-request-id'] as string) ?? 'unknown';

    let status: number;
    let code: string;
    let message: string;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        code = HttpStatus[status] ?? 'INTERNAL_ERROR';
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        code = (obj['code'] as string) ?? HttpStatus[status] ?? 'INTERNAL_ERROR';
        message = (obj['message'] as string) ?? 'An unexpected error occurred';
        details = obj['details'] as Record<string, unknown> | undefined;
      } else {
        code = 'INTERNAL_ERROR';
        message = 'An unexpected error occurred';
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';
      this.logger.error(exception, `Unhandled exception [traceId=${traceId}]`);
    }

    const errorBody: UnifiedError = {
      code,
      message,
      ...(details !== undefined && { details }),
      traceId,
    };

    response.status(status).json(errorBody);
  }
}
