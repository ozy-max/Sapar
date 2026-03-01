import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const SERVICE_NAME = 'api-gateway';

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

/* ── Circuit Breaker ─────────────────────────────────────── */

export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (1 = active for given state)',
  labelNames: ['service', 'target', 'state'] as const,
  registers: [registry],
});

export const circuitBreakerOpenTotal = new Counter({
  name: 'circuit_breaker_open_total',
  help: 'Total times circuit breaker transitioned to OPEN',
  labelNames: ['service', 'target'] as const,
  registers: [registry],
});

/* ── Outbound retries / failures ─────────────────────────── */

export const outboundRetriesTotal = new Counter({
  name: 'outbound_retries_total',
  help: 'Total outbound call retries',
  labelNames: ['service', 'target', 'operation'] as const,
  registers: [registry],
});

export const outboundFailuresTotal = new Counter({
  name: 'outbound_failures_total',
  help: 'Total outbound call final failures',
  labelNames: ['service', 'target', 'operation'] as const,
  registers: [registry],
});

/* ── Redis (rate-limiter) ────────────────────────────────── */

export const redisRequestDurationMs = new Histogram({
  name: 'redis_request_duration_ms',
  help: 'Redis request duration in milliseconds',
  labelNames: ['operation'] as const,
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const redisErrorsTotal = new Counter({
  name: 'redis_errors_total',
  help: 'Total Redis errors',
  labelNames: ['operation'] as const,
  registers: [registry],
});
