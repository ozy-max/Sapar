import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Logger } from '@nestjs/common';
import { RateLimitPolicy, matchPolicy } from './ratelimit.policy';
import { buildRateLimitKey } from './keys';
import { RateLimitService } from './ratelimit.service';
import { RateLimitMetrics } from './metrics';
import { buildRateLimitedBody, buildLimiterUnavailableBody } from './errors';

const logger = new Logger('RateLimitGuard');

export function createRateLimitGuard(
  policies: ReadonlyArray<RateLimitPolicy>,
  service: RateLimitService,
  metrics: RateLimitMetrics,
  _trustProxy: boolean,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const policy = matchPolicy(req.path, policies);
    if (!policy) {
      next();
      return;
    }

    const traceId = (req.headers['x-request-id'] as string) ?? 'unknown';
    const clientKey = buildRateLimitKey(req);
    const redisKey = `rl:${policy.prefix}:${clientKey}`;
    const start = performance.now();

    void service
      .checkRateLimit(redisKey, policy.rpm, policy.windowSec)
      .then((decision) => {
        const latencyMs = Math.round(performance.now() - start);
        metrics.recordRedisLatency({ upstream: policy.prefix, latencyMs });

        if (decision.allowed) {
          logger.debug({
            msg: 'rate_limit_allowed',
            upstream: policy.prefix,
            key: clientKey,
            remaining: decision.remaining,
            traceId,
            latencyMs,
          });
          metrics.recordAllowed({
            upstream: policy.prefix,
            key: clientKey,
            remaining: decision.remaining,
          });
          next();
          return;
        }

        const retryAfterSec = Math.max(1, decision.resetAtEpochSec - Math.floor(Date.now() / 1000));

        logger.warn({
          msg: 'rate_limit_exceeded',
          upstream: policy.prefix,
          key: clientKey,
          allowed: false,
          retryAfterSec,
          traceId,
          latencyMs,
        });
        metrics.recordLimited({
          upstream: policy.prefix,
          key: clientKey,
          retryAfterSec,
        });

        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json(buildRateLimitedBody(traceId, retryAfterSec));
      })
      .catch((err: unknown) => {
        const latencyMs = Math.round(performance.now() - start);
        const errorMsg = err instanceof Error ? err.message : String(err);
        metrics.recordError({ upstream: policy.prefix, error: errorMsg });

        if (policy.failStrategy === 'closed') {
          logger.error({
            msg: 'rate_limiter_unavailable_closed',
            upstream: policy.prefix,
            key: clientKey,
            error: errorMsg,
            traceId,
            latencyMs,
          });
          res.status(503).json(buildLimiterUnavailableBody(traceId));
          return;
        }

        logger.warn({
          msg: 'rate_limiter_unavailable_open',
          upstream: policy.prefix,
          key: clientKey,
          error: errorMsg,
          traceId,
          latencyMs,
        });
        next();
      });
  };
}
