export interface ProxyMetrics {
  recordRequest(params: {
    upstream: string;
    method: string;
    status: number;
    latencyMs: number;
  }): void;
}

export class NoopProxyMetrics implements ProxyMetrics {
  recordRequest(_params: {
    upstream: string;
    method: string;
    status: number;
    latencyMs: number;
  }): void {
    /* noop — swap with Prometheus/StatsD impl when ready */
  }
}
