import { createHash } from 'node:crypto';
import { Request } from 'express';

/**
 * Builds a deterministic rate-limit key for the request.
 *
 * Strategy:
 *   1. Base = client IP from req.ip (raw socket address; Express trust-proxy is OFF).
 *      If TRUST_PROXY=true and X-Forwarded-For is present, the leftmost IP is used
 *      (set by the nearest trusted reverse-proxy, e.g. nginx / ALB).
 *
 *   2. If an Authorization header is present, a SHA-256 hash of the token is appended.
 *      This reduces false-positive throttling for authenticated users behind shared NAT
 *      gateways — each user gets an independent bucket.
 *
 *      Trade-off: an attacker can forge distinct Authorization values to get separate
 *      buckets per-token. This is acceptable because the token is validated by downstream
 *      services; unauthenticated abuse is bounded by the IP-only bucket.
 */
export function buildRateLimitKey(req: Request, trustProxy: boolean): string {
  let ip = normalizeIp(req.ip ?? req.socket.remoteAddress ?? '0.0.0.0');

  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const leftmost = xff.split(',')[0]?.trim();
      if (leftmost && looksLikeIp(leftmost)) {
        ip = normalizeIp(leftmost);
      }
    }
  }

  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.length > 0) {
    const hash = createHash('sha256').update(auth).digest('hex').slice(0, 16);
    return `${ip}:${hash}`;
  }

  return ip;
}

function normalizeIp(raw: string): string {
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function looksLikeIp(value: string): boolean {
  return /^[\d.]+$/.test(value) || /^[a-fA-F\d:]+$/.test(value);
}
