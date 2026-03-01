import { HttpException, HttpStatus } from '@nestjs/common';

export interface UnifiedErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId: string;
}

export const ProxyErrorCode = {
  DOWNSTREAM_UNAVAILABLE: 'DOWNSTREAM_UNAVAILABLE',
  DOWNSTREAM_TIMEOUT: 'DOWNSTREAM_TIMEOUT',
  BAD_GATEWAY: 'BAD_GATEWAY',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
} as const;

export type ProxyErrorCodeType =
  (typeof ProxyErrorCode)[keyof typeof ProxyErrorCode];

export function createProxyError(
  code: ProxyErrorCodeType,
  traceId: string,
  details?: Record<string, unknown>,
): HttpException {
  const mapping: Record<
    ProxyErrorCodeType,
    { status: number; message: string }
  > = {
    [ProxyErrorCode.DOWNSTREAM_UNAVAILABLE]: {
      status: HttpStatus.BAD_GATEWAY,
      message: 'Downstream service is unavailable',
    },
    [ProxyErrorCode.DOWNSTREAM_TIMEOUT]: {
      status: HttpStatus.GATEWAY_TIMEOUT,
      message: 'Downstream service timed out',
    },
    [ProxyErrorCode.BAD_GATEWAY]: {
      status: HttpStatus.BAD_GATEWAY,
      message: 'Bad gateway',
    },
    [ProxyErrorCode.PAYLOAD_TOO_LARGE]: {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'Request body exceeds maximum allowed size',
    },
  };

  const entry = mapping[code];
  const body: UnifiedErrorBody = {
    code,
    message: entry.message,
    ...(details !== undefined && { details }),
    traceId,
  };

  return new HttpException(body, entry.status);
}

export function mapDownstreamError(
  error: unknown,
  traceId: string,
): HttpException {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const cause = (error as { cause?: { code?: string } }).cause;
    const causeCode = cause?.code ?? '';

    if (
      msg.includes('abort') ||
      msg.includes('timeout') ||
      causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
      causeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
      causeCode === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return createProxyError(ProxyErrorCode.DOWNSTREAM_TIMEOUT, traceId);
    }

    if (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('econnreset') ||
      causeCode === 'ECONNREFUSED' ||
      causeCode === 'ENOTFOUND' ||
      causeCode === 'ECONNRESET'
    ) {
      return createProxyError(
        ProxyErrorCode.DOWNSTREAM_UNAVAILABLE,
        traceId,
      );
    }
  }

  return createProxyError(ProxyErrorCode.BAD_GATEWAY, traceId);
}
