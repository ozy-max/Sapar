export interface RateLimitErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly traceId: string;
}

export function buildRateLimitedBody(
  traceId: string,
  retryAfterSec: number,
): RateLimitErrorBody {
  return {
    code: 'RATE_LIMITED',
    message: 'Too many requests',
    details: { retryAfterSec },
    traceId,
  };
}

export function buildLimiterUnavailableBody(
  traceId: string,
): RateLimitErrorBody {
  return {
    code: 'RATE_LIMITER_UNAVAILABLE',
    message: 'Rate limiter is temporarily unavailable',
    traceId,
  };
}
