import { Request } from 'express';

/**
 * Express sets req.ip correctly based on the app-level 'trust proxy' setting,
 * picking the right address from the X-Forwarded-For chain.
 * No manual XFF parsing needed — that was vulnerable to client spoofing.
 */
export function buildRateLimitKey(req: Request): string {
  const raw = req.ip ?? req.socket.remoteAddress ?? '0.0.0.0';
  return normalizeIp(raw);
}

function normalizeIp(raw: string): string {
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}
