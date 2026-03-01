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
  DOWNSTREAM_CIRCUIT_OPEN: 'DOWNSTREAM_CIRCUIT_OPEN',
  BAD_GATEWAY: 'BAD_GATEWAY',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
} as const;

export type ProxyErrorCodeType = (typeof ProxyErrorCode)[keyof typeof ProxyErrorCode];

export function createProxyError(
  code: ProxyErrorCodeType,
  traceId: string,
  details?: Record<string, unknown>,
): HttpException {
  const mapping: Record<ProxyErrorCodeType, { status: number; message: string }> = {
    [ProxyErrorCode.DOWNSTREAM_UNAVAILABLE]: {
      status: HttpStatus.BAD_GATEWAY,
      message: 'Downstream service is unavailable',
    },
    [ProxyErrorCode.DOWNSTREAM_TIMEOUT]: {
      status: HttpStatus.GATEWAY_TIMEOUT,
      message: 'Downstream service timed out',
    },
    [ProxyErrorCode.DOWNSTREAM_CIRCUIT_OPEN]: {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Downstream service circuit breaker is open',
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

export function mapDownstreamError(error: unknown, traceId: string): HttpException {
  const err = error as Record<string, unknown> | null | undefined;
  const msg = (
    error instanceof Error
      ? error.message
      : typeof err?.['message'] === 'string'
        ? (err['message'] as string)
        : String(error)
  ).toLowerCase();

  const cause = (err?.['cause'] ?? null) as Record<string, unknown> | null;
  const causeCode = (typeof cause?.['code'] === 'string' ? cause['code'] : '') as string;
  const errCode = (typeof err?.['code'] === 'string' ? err['code'] : '') as string;
  const errName = (typeof err?.['name'] === 'string' ? err['name'] : '') as string;

  if (
    msg.includes('abort') ||
    msg.includes('timeout') ||
    errName === 'TimeoutError' ||
    errCode === 'UND_ERR_CONNECT_TIMEOUT' ||
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
    errCode === 'ECONNREFUSED' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ENOTFOUND' ||
    causeCode === 'ECONNRESET'
  ) {
    return createProxyError(ProxyErrorCode.DOWNSTREAM_UNAVAILABLE, traceId);
  }

  return createProxyError(ProxyErrorCode.BAD_GATEWAY, traceId);
}
