import type { Env } from '../../../config/env';

export type FailStrategy = 'open' | 'closed';

export interface RateLimitPolicy {
  readonly prefix: string;
  readonly rpm: number;
  readonly windowSec: number;
  readonly failStrategy: FailStrategy;
}

export function buildRateLimitPolicies(env: Env): ReadonlyArray<RateLimitPolicy> {
  return [
    {
      prefix: 'identity',
      rpm: env.RATE_IDENTITY_RPM,
      windowSec: env.RATE_LIMIT_WINDOW_SEC,
      failStrategy: 'open',
    },
    {
      prefix: 'trips',
      rpm: env.RATE_TRIPS_RPM,
      windowSec: env.RATE_LIMIT_WINDOW_SEC,
      failStrategy: 'open',
    },
    {
      prefix: 'payments',
      rpm: env.RATE_PAYMENTS_RPM,
      windowSec: env.RATE_LIMIT_WINDOW_SEC,
      failStrategy: 'closed',
    },
    {
      prefix: 'admin',
      rpm: env.RATE_ADMIN_RPM,
      windowSec: env.RATE_LIMIT_WINDOW_SEC,
      failStrategy: 'closed',
    },
  ];
}

export function matchPolicy(
  path: string,
  policies: ReadonlyArray<RateLimitPolicy>,
): RateLimitPolicy | undefined {
  for (const policy of policies) {
    if (path.startsWith(`/${policy.prefix}/`) || path === `/${policy.prefix}`) {
      return policy;
    }
  }
  return undefined;
}
