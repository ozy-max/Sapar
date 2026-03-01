import { RateLimitMetrics } from '../adapters/http/ratelimit/metrics';
import {
  appErrorsTotal,
  redisRequestDurationMs,
  redisErrorsTotal,
} from './metrics.registry';

export class PrometheusRateLimitMetrics implements RateLimitMetrics {
  recordAllowed(_p: {
    upstream: string;
    key: string;
    remaining: number;
  }): void {
    /* successful pass-through — counted by httpMetricsMiddleware */
  }

  recordLimited(_p: {
    upstream: string;
    key: string;
    retryAfterSec: number;
  }): void {
    appErrorsTotal.labels('RATE_LIMITED').inc();
  }

  recordError(_p: { upstream: string; error: string }): void {
    redisErrorsTotal.labels('rate_limit').inc();
  }

  recordRedisLatency(p: { upstream: string; latencyMs: number }): void {
    redisRequestDurationMs.labels('rate_limit').observe(p.latencyMs);
  }
}
