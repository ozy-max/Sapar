import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { signPayload } from './hmac';

interface ConfigItem {
  key: string;
  type: string;
  valueJson: unknown;
  version: number;
}

interface ConfigSnapshot {
  items: Map<string, ConfigItem>;
  lastEtag: string | null;
  lastFetchAt: number;
}

@Injectable()
export class ConfigClient implements OnModuleInit {
  private readonly logger = new Logger(ConfigClient.name);
  private snapshot: ConfigSnapshot = {
    items: new Map(),
    lastEtag: null,
    lastFetchAt: 0,
  };

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') return;
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn(`Initial config fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  get<T = unknown>(key: string): T | undefined {
    this.refreshIfStale();
    const item = this.snapshot.items.get(key);
    return item ? (item.valueJson as T) : undefined;
  }

  getAll(): ConfigItem[] {
    this.refreshIfStale();
    return Array.from(this.snapshot.items.values());
  }

  private refreshIfStale(): void {
    const env = loadEnv();
    const age = Date.now() - this.snapshot.lastFetchAt;
    if (age > env.CONFIG_CACHE_TTL_MS) {
      void this.refresh().catch((err) => {
        this.logger.warn(`Background config refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  async refresh(): Promise<void> {
    const env = loadEnv();
    const url = `${env.CONFIG_BASE_URL}/internal/configs`;
    const body = '';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(body, timestamp, env.EVENTS_HMAC_SECRET);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.CONFIG_FETCH_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'X-Event-Signature': signature,
        'X-Event-Timestamp': String(timestamp),
      };

      if (this.snapshot.lastEtag) {
        headers['If-None-Match'] = this.snapshot.lastEtag;
      }

      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 304) {
        this.snapshot.lastFetchAt = Date.now();
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as { items: ConfigItem[] };
      const etag = response.headers.get('etag');

      const map = new Map<string, ConfigItem>();
      for (const item of data.items) {
        map.set(item.key, item);
      }

      this.snapshot = {
        items: map,
        lastEtag: etag,
        lastFetchAt: Date.now(),
      };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
}
