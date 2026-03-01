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
  ];
}

export function resolveRoute(
  path: string,
  table: ReadonlyArray<RouteEntry>,
): { route: RouteEntry; downstream: string } | undefined {
  for (const route of table) {
    const prefixWithSlash = `/${route.prefix}/`;
    if (path.startsWith(prefixWithSlash) || path === `/${route.prefix}`) {
      const downstream = path.slice(`/${route.prefix}`.length) || '/';
      return { route, downstream };
    }
  }
  return undefined;
}
