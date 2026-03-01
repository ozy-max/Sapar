import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { recordAppError } from '../../../observability/error-metrics';

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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        code = HttpStatus[status] ?? code;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        code = (obj['code'] as string) ?? HttpStatus[status] ?? code;
        message = (obj['message'] as string) ?? message;
        details = obj['details'] as Record<string, unknown> | undefined;
      }
    } else {
      const raw = exception as Record<string, unknown> | null;
      const rawStatus = (raw?.['status'] ?? raw?.['statusCode']) as number | undefined;

      if (typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600) {
        status = rawStatus;
        const rawType = raw?.['type'] as string | undefined;
        if (rawType === 'entity.too.large' || rawStatus === 413) {
          code = 'PAYLOAD_TOO_LARGE';
        } else {
          code = HttpStatus[status] ?? code;
        }
        message = typeof raw?.['message'] === 'string' ? (raw['message'] as string) : message;
      }

      this.logger.error(exception, `Unhandled exception [traceId=${traceId}]`);
    }

    recordAppError(code);

    const errorBody: UnifiedError = {
      code,
      message,
      ...(details !== undefined && { details }),
      traceId,
    };

    response.status(status).json(errorBody);
  }
}
