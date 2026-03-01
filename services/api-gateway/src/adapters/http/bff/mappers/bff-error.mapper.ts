import { HttpException, HttpStatus } from '@nestjs/common';
import { BffHttpError } from '../clients/bff-http.client';

interface UnifiedBffError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId: string;
}

export function mapBffError(error: unknown, traceId: string): HttpException {
  if (error instanceof BffHttpError) {
    if (error.isTimeout) {
      const body: UnifiedBffError = {
        code: 'DOWNSTREAM_TIMEOUT',
        message: `Upstream ${error.upstream} timed out`,
        traceId,
      };
      return new HttpException(body, HttpStatus.GATEWAY_TIMEOUT);
    }

    if (error.status === 404) {
      const body: UnifiedBffError = {
        code: 'NOT_FOUND',
        message: extractMessage(error.body) ?? 'Resource not found',
        traceId,
      };
      return new HttpException(body, HttpStatus.NOT_FOUND);
    }

    if (error.status >= 400 && error.status < 500) {
      const body: UnifiedBffError = {
        code: extractCode(error.body) ?? 'BAD_REQUEST',
        message: extractMessage(error.body) ?? 'Bad request to downstream',
        traceId,
      };
      return new HttpException(body, error.status);
    }

    const body: UnifiedBffError = {
      code: 'BAD_GATEWAY',
      message: `Upstream ${error.upstream} returned ${error.status}`,
      traceId,
    };
    return new HttpException(body, HttpStatus.BAD_GATEWAY);
  }

  const body: UnifiedBffError = {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred in BFF layer',
    traceId,
  };
  return new HttpException(body, HttpStatus.INTERNAL_SERVER_ERROR);
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;
    if (typeof obj['message'] === 'string') return obj['message'];
  }
  return undefined;
}

function extractCode(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;
    if (typeof obj['code'] === 'string') return obj['code'];
  }
  return undefined;
}
