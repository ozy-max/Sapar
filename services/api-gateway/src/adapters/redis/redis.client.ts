import Redis from 'ioredis';

let instance: Redis | undefined;

/**
 * Singleton Redis client.
 * enableOfflineQueue=false ensures commands fail immediately when disconnected
 * (critical for high-load: prevents unbounded memory growth during Redis outages).
 * maxRetriesPerRequest=0 disables per-command retries; the rate limit service
 * applies its own hard timeout via Promise.race.
 */
export function getRedisClient(url: string): Redis {
  if (instance) return instance;

  instance = new Redis(url, {
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: 3_000,
    retryStrategy(times: number): number | null {
      if (times > 5) return null;
      return Math.min(times * 500, 3_000);
    },
  });

  instance.on('error', () => {
    /* swallowed — per-command errors handled by RateLimitService */
  });

  return instance;
}

export function getRedisInstance(): Redis | undefined {
  return instance;
}

export async function closeRedisClient(): Promise<void> {
  if (!instance) return;
  try {
    await instance.quit();
  } catch {
    instance.disconnect();
  }
  instance = undefined;
}

export function resetRedisClient(): void {
  if (instance) {
    instance.disconnect();
  }
  instance = undefined;
}
