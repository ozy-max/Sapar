import { request as undiciRequest } from 'undici';
import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { getSharedDispatcher } from '../../proxy/http-client';
import { loadEnv } from '../../../../config/env';

const logger = new Logger('BffHttpClient');

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
  ) {
    super(
      isTimeout
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

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmacSignature = createHmac('sha256', loadEnv().EVENTS_HMAC_SECRET)
    .update(`${timestamp}.${bodyStr}`)
    .digest('hex');

  try {
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
    const latencyMs = Math.round(performance.now() - start);

    logger.log({
      msg: 'bff_fetch',
      upstream,
      method,
      path: opts.path,
      status: resp.statusCode,
      latencyMs,
    });

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
  } catch (error: unknown) {
    if (error instanceof BffHttpError) throw error;

    const latencyMs = Math.round(performance.now() - start);
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
