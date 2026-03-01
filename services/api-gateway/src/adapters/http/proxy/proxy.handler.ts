import { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { request as undiciRequest } from 'undici';
import { RouteEntry } from './route-table';
import { pickRequestHeaders, pickResponseHeaders, HeadersRecord } from './headers';
import {
  createProxyError,
  mapDownstreamError,
  ProxyErrorCode,
  UnifiedErrorBody,
} from './errors';
import { ProxyMetrics } from './metrics';
import { getSharedDispatcher } from './http-client';
import { loadEnv } from '../../../config/env';
import { recordAppError } from '../../../observability/error-metrics';

const logger = new Logger('ProxyHandler');

export async function handleProxy(
  req: Request,
  res: Response,
  route: RouteEntry,
  downstreamPath: string,
  metrics: ProxyMetrics,
): Promise<void> {
  const env = loadEnv();
  const traceId = (req.headers['x-request-id'] as string) ?? 'unknown';
  const method = req.method;
  const start = performance.now();

  const bodyBytes = req.body
    ? Buffer.byteLength(
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      )
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
    hasBody && req.body !== undefined && req.body !== null
      ? JSON.stringify(req.body)
      : undefined;

  try {
    const downstream = await undiciRequest(fullUrl, {
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: forwardHeaders,
      body: requestBody,
      dispatcher: getSharedDispatcher(),
      signal: AbortSignal.timeout(env.HTTP_TIMEOUT_MS),
    });

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

    metrics.recordRequest({
      upstream: route.upstream,
      method,
      status,
      latencyMs,
    });

    const safeHeaders = pickResponseHeaders(
      downstream.headers as HeadersRecord,
    );
    for (const [key, value] of Object.entries(safeHeaders)) {
      res.setHeader(key, value);
    }

    const responseBody = await downstream.body.text();
    res.status(status);

    if (
      safeHeaders['content-type']?.includes('application/json') &&
      responseBody.length > 0
    ) {
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

    logger.error({
      msg: 'proxy_error',
      method,
      upstream: route.upstream,
      latencyMs,
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    metrics.recordRequest({
      upstream: route.upstream,
      method,
      status: 502,
      latencyMs,
    });

    const httpErr = mapDownstreamError(error, traceId);
    const body = httpErr.getResponse() as UnifiedErrorBody;
    recordAppError(body.code);
    res.status(httpErr.getStatus()).json(body);
  }
}
