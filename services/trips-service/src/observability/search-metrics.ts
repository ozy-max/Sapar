import { Counter, Histogram } from 'prom-client';
import { registry } from './metrics.registry';

const SEARCH_DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
const ROWS_BUCKETS = [0, 1, 5, 10, 25, 50, 100, 500];

export const tripsSearchRequestsTotal = new Counter({
  name: 'trips_search_requests_total',
  help: 'Total search requests by result',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const tripsSearchDurationMs = new Histogram({
  name: 'trips_search_duration_ms',
  help: 'Search endpoint duration in ms',
  buckets: SEARCH_DURATION_BUCKETS,
  registers: [registry],
});

export const tripsSearchDbRowsReturned = new Histogram({
  name: 'trips_search_db_rows_returned',
  help: 'Number of DB rows returned per search query',
  buckets: ROWS_BUCKETS,
  registers: [registry],
});

export const searchCacheHitsTotal = new Counter({
  name: 'search_cache_hits_total',
  help: 'Total search cache hits',
  registers: [registry],
});

export const searchCacheMissesTotal = new Counter({
  name: 'search_cache_misses_total',
  help: 'Total search cache misses',
  registers: [registry],
});

export const searchCacheErrorsTotal = new Counter({
  name: 'search_cache_errors_total',
  help: 'Total search cache errors',
  registers: [registry],
});
