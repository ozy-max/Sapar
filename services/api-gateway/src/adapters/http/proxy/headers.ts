import { IncomingHttpHeaders } from 'node:http';

const FORWARDED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'x-request-id',
  'authorization',
  'content-type',
  'accept',
]);

const ALLOWED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'cache-control',
  'etag',
  'x-request-id',
  'last-modified',
  'vary',
]);

const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

export function pickRequestHeaders(
  incoming: IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

export type HeadersRecord = Record<string, string | string[] | undefined>;

export function pickResponseHeaders(
  downstream: HeadersRecord,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(downstream)) {
    const lower = key.toLowerCase();
    if (ALLOWED_RESPONSE_HEADERS.has(lower) && !HOP_BY_HOP.has(lower)) {
      result[lower] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }
  }
  return result;
}
