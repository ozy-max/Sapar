import { Request, Response, NextFunction } from 'express';
import {
  httpRequestsTotal,
  httpRequestDurationMs,
  httpInFlightRequests,
  httpServerErrorsTotal,
} from './metrics.registry';
import { normalizeRoute } from './route-normalizer';

const SKIP_PREFIXES = ['/metrics', '/swagger'];

function shouldSkip(path: string): boolean {
  return SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkip(req.path)) {
    next();
    return;
  }

  const start = performance.now();
  httpInFlightRequests.inc();

  res.on('finish', () => {
    const durationMs = performance.now() - start;
    const route = normalizeRoute(req.path);
    const method = req.method;
    const status = String(res.statusCode);

    httpRequestsTotal.labels(method, route, status).inc();
    httpRequestDurationMs.labels(method, route).observe(durationMs);
    httpInFlightRequests.dec();

    if (res.statusCode >= 500) {
      httpServerErrorsTotal.inc();
    }
  });

  next();
}
