import { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { request as undiciRequest, Dispatcher } from 'undici';
import { RouteEntry } from './route-table';
import { pickRequestHeaders, pickResponseHeaders, HeadersRecord } from './headers';
import { createProxyError, mapDownstreamError, ProxyErrorCode, UnifiedErrorBody } from './errors';
import { ProxyMetrics } from './metrics';
import { getSharedDispatcher } from './http-client';
import { loadEnv } from '../../../config/env';
import { recordAppError } from '../../../observability/error-metrics';
import { CircuitBreaker, CircuitOpenError } from '../../../shared/resilience/circuit-breaker';
import { withRetry, DEFAULT_RETRY_CONFIG } from '../../../shared/resilience/retry';
import {
  SERVICE_NAME,
  outboundRetriesTotal,
  outboundFailuresTotal,
} from '../../../observability/metrics.registry';

const logger = new Logger('ProxyHandler');

class RetryableUpstreamError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly upstream: string,
  ) {
    super(`Upstream ${upstream} returned ${statusCode}`);
    this.name = 'RetryableUpstreamError';
  }
}

function shouldRetryProxy(error: unknown): boolean {
  if (error instanceof CircuitOpenError) return false;
  if (error instanceof RetryableUpstreamError) return true;
  return true;
}

export async function handleProxy(
  req: Request,
  res: Response,
  route: RouteEntry,
  downstreamPath: string,
  metrics: ProxyMetrics,
  breaker: CircuitBreaker,
): Promise<void> {
  const env = loadEnv();
  const traceId = (req.headers['x-request-id'] as string) ?? 'unknown';
  const method = req.method;
  const start = performance.now();

  const bodyBytes = req.body
    ? Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    : 0;

  if (bodyBytes > env.MAX_BODY_BYTES) {
    const err = createProxyError(ProxyErrorCode.PAYLOAD_TOO_LARGE, traceId, {
      maxBytes: env.MAX_BODY_BYTES,
      receivedBytes: bodyBytes,
    });
    const body = err.getResponse() as UnifiedErrorBody;
    recordAppError(body.code);
    res.status(err.getStatus()).json(body);
    return;
  }

  const targetUrl = `${route.baseUrl}${downstreamPath}`;
  const queryString = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  const fullUrl = `${targetUrl}${queryString}`;

  const forwardHeaders = pickRequestHeaders(req.headers);
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
  const requestBody =
    hasBody && req.body !== undefined && req.body !== null ? JSON.stringify(req.body) : undefined;

  const doRequest = (): Promise<Dispatcher.ResponseData> =>
    breaker.execute(
      () =>
        undiciRequest(fullUrl, {
          method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          headers: forwardHeaders,
          body: requestBody,
          dispatcher: getSharedDispatcher(),
          signal: AbortSignal.timeout(env.HTTP_TIMEOUT_MS),
        }),
      { traceId, isSuccess: (resp) => resp.statusCode < 500 },
    );

  try {
    let downstream: Dispatcher.ResponseData;
    const isIdempotent = method === 'GET' || method === 'HEAD';

    if (isIdempotent) {
      downstream = await withRetry(
        async () => {
          const resp = await doRequest();
          if (resp.statusCode >= 500) {
            await resp.body.text();
            throw new RetryableUpstreamError(resp.statusCode, route.upstream);
          }
          return resp;
        },
        DEFAULT_RETRY_CONFIG,
        shouldRetryProxy,
        (attempt, _err, _delay) => {
          outboundRetriesTotal.labels(SERVICE_NAME, route.upstream, `proxy_${method}`).inc();
          logger.warn({
            msg: 'proxy_retry',
            upstream: route.upstream,
            method,
            attempt,
            traceId,
          });
        },
      );
    } else {
      downstream = await doRequest();
    }

    const latencyMs = Math.round(performance.now() - start);
    const status = downstream.statusCode;

    logger.log({
      msg: 'proxy_request',
      method,
      upstream: route.upstream,
      status,
      latencyMs,
      traceId,
    });

    metrics.recordRequest({ upstream: route.upstream, method, status, latencyMs });

    const safeHeaders = pickResponseHeaders(downstream.headers as HeadersRecord);
    for (const [key, value] of Object.entries(safeHeaders)) {
      res.setHeader(key, value);
    }

    const maxResponseBytes = env.MAX_DOWNSTREAM_RESPONSE_BYTES;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of downstream.body) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      totalBytes += buf.length;
      if (totalBytes > maxResponseBytes) {
        downstream.body.destroy();
        const err = createProxyError(ProxyErrorCode.PAYLOAD_TOO_LARGE, traceId, {
          maxBytes: maxResponseBytes,
          receivedBytes: totalBytes,
        });
        const errBody = err.getResponse() as UnifiedErrorBody;
        recordAppError(errBody.code);
        res.status(502).json(errBody);
        return;
      }
      chunks.push(buf);
    }
    const responseBody = Buffer.concat(chunks).toString('utf-8');
    res.status(status);

    if (safeHeaders['content-type']?.includes('application/json') && responseBody.length > 0) {
      try {
        const parsed: unknown = JSON.parse(responseBody);
        res.json(parsed);
      } catch {
        res.send(responseBody);
      }
    } else {
      res.send(responseBody);
    }
  } catch (error: unknown) {
    const latencyMs = Math.round(performance.now() - start);

    if (error instanceof CircuitOpenError) {
      logger.warn({
        msg: 'proxy_circuit_open',
        upstream: route.upstream,
        method,
        latencyMs,
        traceId,
      });
      metrics.recordRequest({ upstream: route.upstream, method, status: 503, latencyMs });
      const httpErr = createProxyError(ProxyErrorCode.DOWNSTREAM_CIRCUIT_OPEN, traceId, {
        target: route.upstream,
      });
      const body = httpErr.getResponse() as UnifiedErrorBody;
      recordAppError(body.code);
      res.status(httpErr.getStatus()).json(body);
      return;
    }

    outboundFailuresTotal.labels(SERVICE_NAME, route.upstream, `proxy_${method}`).inc();

    logger.error({
      msg: 'proxy_error',
      method,
      upstream: route.upstream,
      latencyMs,
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    metrics.recordRequest({ upstream: route.upstream, method, status: 502, latencyMs });

    const httpErr = mapDownstreamError(error, traceId);
    const body = httpErr.getResponse() as UnifiedErrorBody;
    recordAppError(body.code);
    res.status(httpErr.getStatus()).json(body);
  }
}
