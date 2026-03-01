export interface RateLimitMetrics {
  recordAllowed(params: { upstream: string; key: string; remaining: number }): void;
  recordLimited(params: { upstream: string; key: string; retryAfterSec: number }): void;
  recordError(params: { upstream: string; error: string }): void;
  recordRedisLatency(params: { upstream: string; latencyMs: number }): void;
}

export class NoopRateLimitMetrics implements RateLimitMetrics {
  recordAllowed(_p: { upstream: string; key: string; remaining: number }): void {}
  recordLimited(_p: { upstream: string; key: string; retryAfterSec: number }): void {}
  recordError(_p: { upstream: string; error: string }): void {}
  recordRedisLatency(_p: { upstream: string; latencyMs: number }): void {}
}
