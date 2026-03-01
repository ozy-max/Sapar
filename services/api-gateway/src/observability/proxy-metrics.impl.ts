import { ProxyMetrics } from '../adapters/http/proxy/metrics';

/**
 * HTTP-level metrics are handled by httpMetricsMiddleware,
 * so the proxy-specific recordRequest is intentionally a no-op
 * to avoid double-counting.
 */
export class PrometheusProxyMetrics implements ProxyMetrics {
  recordRequest(_params: {
    upstream: string;
    method: string;
    status: number;
    latencyMs: number;
  }): void {
    /* handled by httpMetricsMiddleware */
  }
}
