import { posix } from 'node:path';
import { loadEnv } from '../../../config/env';

export interface RouteEntry {
  readonly prefix: string;
  readonly upstream: string;
  readonly baseUrl: string;
}

export function buildRouteTable(): ReadonlyArray<RouteEntry> {
  const env = loadEnv();
  return [
    { prefix: 'identity', upstream: 'identity', baseUrl: env.IDENTITY_BASE_URL },
    { prefix: 'trips', upstream: 'trips', baseUrl: env.TRIPS_BASE_URL },
    { prefix: 'payments', upstream: 'payments', baseUrl: env.PAYMENTS_BASE_URL },
    { prefix: 'admin', upstream: 'admin', baseUrl: env.ADMIN_BASE_URL },
    { prefix: 'profiles', upstream: 'profiles', baseUrl: env.PROFILES_BASE_URL },
  ];
}

export function resolveRoute(
  path: string,
  table: ReadonlyArray<RouteEntry>,
): { route: RouteEntry; downstream: string } | undefined {
  const normalized = posix.normalize(path);
  if (normalized.includes('..')) {
    return undefined;
  }

  for (const route of table) {
    const prefixWithSlash = `/${route.prefix}/`;
    if (normalized.startsWith(prefixWithSlash) || normalized === `/${route.prefix}`) {
      const downstream = normalized.slice(`/${route.prefix}`.length) || '/';
      return { route, downstream };
    }
  }
  return undefined;
}
