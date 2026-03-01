import { request as undiciRequest } from 'undici';
import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { getSharedDispatcher } from '../../proxy/http-client';
import { loadEnv } from '../../../../config/env';
import { CircuitBreaker, CircuitOpenError } from '../../../../shared/resilience/circuit-breaker';
import { withRetry, DEFAULT_RETRY_CONFIG } from '../../../../shared/resilience/retry';
import { gatewayBreakerListener } from '../../../../observability/resilience-metrics';
import {
  SERVICE_NAME,
  outboundRetriesTotal,
  outboundFailuresTotal,
} from '../../../../observability/metrics.registry';

const logger = new Logger('BffHttpClient');

const bffBreakers = new Map<string, CircuitBreaker>();

function getBreaker(upstream: string): CircuitBreaker {
  let breaker = bffBreakers.get(upstream);
  if (!breaker) {
    const env = loadEnv();
    breaker = new CircuitBreaker(
      {
        name: `bff-${upstream}`,
        rollingWindowMs: env.CB_ROLLING_WINDOW_MS,
        errorThresholdPercent: env.CB_ERROR_THRESHOLD_PERCENT,
        minimumRequests: env.CB_MIN_REQUESTS,
        openDurationMs: env.CB_OPEN_DURATION_MS,
        halfOpenMaxProbes: env.CB_HALF_OPEN_MAX_PROBES,
      },
      gatewayBreakerListener,
    );
    bffBreakers.set(upstream, breaker);
  }
  return breaker;
}

export function resetBffBreakers(): void {
  bffBreakers.clear();
}

export interface BffRequestOptions {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

export interface BffResponse<T = unknown> {
  status: number;
  data: T;
}

export class BffHttpError extends Error {
  constructor(
    public readonly upstream: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly isTimeout: boolean,
    public readonly isCircuitOpen: boolean = false,
  ) {
    super(
      isCircuitOpen
        ? `BFF upstream ${upstream} circuit breaker open`
        : isTimeout
          ? `BFF upstream ${upstream} timed out`
          : `BFF upstream ${upstream} returned ${status}`,
    );
    this.name = 'BffHttpError';
  }
}

export async function bffFetch<T>(
  upstream: string,
  opts: BffRequestOptions,
): Promise<BffResponse<T>> {
  const url = `${opts.baseUrl}${opts.path}`;
  const method = opts.method ?? 'GET';
  const start = performance.now();
  const env = loadEnv();
  const breaker = getBreaker(upstream);

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmacSignature = createHmac('sha256', env.EVENTS_HMAC_SECRET)
    .update(`${timestamp}.${bodyStr}`)
    .digest('hex');

  const doRequest = async (): Promise<BffResponse<T>> =>
    breaker.execute(
      async () => {
        const resp = await undiciRequest(url, {
          method,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-event-signature': hmacSignature,
            'x-event-timestamp': timestamp,
            ...opts.headers,
          },
          body: bodyStr || undefined,
          dispatcher: getSharedDispatcher(),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });

        const text = await resp.body.text();
        const maxBytes = env.MAX_DOWNSTREAM_RESPONSE_BYTES;
        if (text.length > maxBytes) {
          throw new BffHttpError(upstream, 502, null, false);
        }

        let data: T;
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as unknown as T;
        }

        if (resp.statusCode >= 400) {
          throw new BffHttpError(upstream, resp.statusCode, data, false);
        }

        return { status: resp.statusCode, data };
      },
      { isSuccess: (resp) => resp.status < 500 },
    );

  try {
    const isIdempotent = method === 'GET';

    if (isIdempotent) {
      return await withRetry(
        doRequest,
        DEFAULT_RETRY_CONFIG,
        (err) => {
          if (err instanceof CircuitOpenError) return false;
          if (err instanceof BffHttpError) return err.status >= 500;
          return true;
        },
        (attempt) => {
          outboundRetriesTotal.labels(SERVICE_NAME, upstream, `bff_${method}`).inc();
          logger.warn({ msg: 'bff_retry', upstream, method, attempt });
        },
      );
    }

    return await doRequest();
  } catch (error: unknown) {
    const latencyMs = Math.round(performance.now() - start);

    if (error instanceof CircuitOpenError) {
      logger.warn({ msg: 'bff_circuit_open', upstream, latencyMs });
      throw new BffHttpError(upstream, 503, null, false, true);
    }

    if (error instanceof BffHttpError) {
      outboundFailuresTotal.labels(SERVICE_NAME, upstream, `bff_${method}`).inc();
      logger.error({
        msg: 'bff_fetch_error',
        upstream,
        method,
        path: opts.path,
        latencyMs,
        status: error.status,
        isTimeout: error.isTimeout,
      });
      throw error;
    }

    outboundFailuresTotal.labels(SERVICE_NAME, upstream, `bff_${method}`).inc();
    const err = error as Error;
    const msg = err.message?.toLowerCase() ?? '';
    const isTimeout =
      msg.includes('abort') || msg.includes('timeout') || err.name === 'TimeoutError';

    logger.error({
      msg: 'bff_fetch_error',
      upstream,
      method,
      path: opts.path,
      latencyMs,
      error: err.message,
      isTimeout,
    });

    throw new BffHttpError(upstream, isTimeout ? 504 : 502, null, isTimeout);
  }
}
