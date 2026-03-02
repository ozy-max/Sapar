import { Logger } from '@nestjs/common';
import { loadEnv } from '../../../../config/env';
import { bffFetch, BffHttpError } from './bff-http.client';

const logger = new Logger('ProfilesClient');

interface ProfileAggregateResponse {
  userId: string;
  displayName: string;
  ratingAvg: number;
  ratingCount: number;
}

export async function getDriverRatingAggregate(
  driverId: string,
  headers: Record<string, string>,
): Promise<{ ratingAvg: number; ratingCount: number; displayName: string } | null> {
  const env = loadEnv();
  try {
    const resp = await bffFetch<ProfileAggregateResponse>('profiles', {
      baseUrl: env.PROFILES_BASE_URL,
      path: `/profiles/${encodeURIComponent(driverId)}`,
      headers,
      timeoutMs: env.BFF_TIMEOUT_MS,
    });
    return {
      ratingAvg: resp.data.ratingAvg,
      ratingCount: resp.data.ratingCount,
      displayName: resp.data.displayName,
    };
  } catch (error: unknown) {
    if (error instanceof BffHttpError) {
      logger.warn({
        msg: 'profiles_aggregate_best_effort_failed',
        driverId,
        status: error.status,
      });
    } else {
      logger.warn({
        msg: 'profiles_aggregate_best_effort_failed',
        driverId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}
