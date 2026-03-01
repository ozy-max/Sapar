import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

const logger = new Logger('TripsRedisClient');

let client: Redis | null = null;

export function getRedisClient(redisUrl?: string, timeoutMs = 500): Redis | null {
  if (!redisUrl) return null;
  if (client) return client;

  client = new Redis(redisUrl, {
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy(times: number): number | null {
      if (times > 3) return null;
      return Math.min(times * 200, 1000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on('error', (err: Error) => {
    logger.warn(`Redis error: ${err.message}`);
  });

  client.connect().catch((err: Error) => {
    logger.warn(`Redis connect failed: ${err.message}`);
  });

  return client;
}

export function getRedisInstance(): Redis | null {
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
