import { Request, Response, NextFunction } from 'express';

interface BucketEntry {
  count: number;
  resetAt: number;
}

const LOGIN_MAX = 10;
const REGISTER_MAX = 5;
const WINDOW_MS = 60_000;

const buckets = new Map<string, BucketEntry>();

let cleanupHandle: ReturnType<typeof setInterval> | undefined;

function ensureCleanup(): void {
  if (cleanupHandle) return;
  cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  cleanupHandle.unref();
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function check(key: string, max: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, entry);
  }

  entry.count++;
  const allowed = entry.count <= max;
  return { allowed, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
}

export function authRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  let max: number;

  if (path === '/auth/login') {
    max = LOGIN_MAX;
  } else if (path === '/auth/register') {
    max = REGISTER_MAX;
  } else {
    next();
    return;
  }

  ensureCleanup();

  const ip = getClientIp(req);
  const key = `${path}:${ip}`;
  const { allowed, remaining, resetAt } = check(key, max);

  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

  if (!allowed) {
    res.status(429).json({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    });
    return;
  }

  next();
}
