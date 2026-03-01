import { Global, Module } from '@nestjs/common';
import { JwtTokenService } from './jwt.service';
import { ConfigClient } from './config-client';
import { SearchCacheService } from '../adapters/redis/search-cache.service';
import { getRedisClient } from '../adapters/redis/redis.client';
import { loadEnv } from '../config/env';

const searchCacheProvider = {
  provide: SearchCacheService,
  useFactory: (): SearchCacheService => {
    const env = loadEnv();
    const redis = getRedisClient(env.REDIS_URL, env.REDIS_TIMEOUT_MS);
    return new SearchCacheService(redis, env.SEARCH_CACHE_TTL_SEC);
  },
};

@Global()
@Module({
  providers: [JwtTokenService, ConfigClient, searchCacheProvider],
  exports: [JwtTokenService, ConfigClient, SearchCacheService],
})
export class SharedModule {}
