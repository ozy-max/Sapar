import Redis from 'ioredis';
import {
  SLIDING_WINDOW_SCRIPT,
  parseLuaResult,
  type LuaRateLimitResult,
} from '../../redis/ratelimit.lua';

export class RateLimitService {
  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs: number,
  ) {}

  async checkRateLimit(key: string, limit: number, windowSec: number): Promise<LuaRateLimitResult> {
    const nowSec = Date.now() / 1000;
    const raw = await withTimeout(
      this.redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        key,
        String(windowSec),
        String(limit),
        String(nowSec),
      ) as Promise<[number, number, number]>,
      this.timeoutMs,
    );
    return parseLuaResult(raw);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Redis timeout after ${ms}ms`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
