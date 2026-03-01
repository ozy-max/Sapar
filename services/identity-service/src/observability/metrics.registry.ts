import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const SERVICE_NAME = 'identity-service';

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export const registry = new Registry();
registry.setDefaultLabels({ service: SERVICE_NAME });
collectDefaultMetrics({ register: registry });

/* ── HTTP ────────────────────────────────────────────────── */

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpRequestDurationMs = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route'] as const,
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const httpInFlightRequests = new Gauge({
  name: 'http_in_flight_requests',
  help: 'Number of in-flight HTTP requests',
  registers: [registry],
});

/* ── Errors ──────────────────────────────────────────────── */

export const appErrorsTotal = new Counter({
  name: 'app_errors_total',
  help: 'Total application errors by unified error code',
  labelNames: ['code'] as const,
  registers: [registry],
});

export const httpServerErrorsTotal = new Counter({
  name: 'http_server_errors_total',
  help: 'Total 5xx HTTP server responses',
  registers: [registry],
});

/* ── Database (Prisma) ───────────────────────────────────── */

export const dbQueryDurationMs = new Histogram({
  name: 'db_query_duration_ms',
  help: 'Database query duration in milliseconds',
  labelNames: ['operation'] as const,
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const dbErrorsTotal = new Counter({
  name: 'db_errors_total',
  help: 'Total database errors',
  labelNames: ['operation'] as const,
  registers: [registry],
});
