import { loadEnv, resetEnvCache } from '../env';

function baselineEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/test',
    IDENTITY_BASE_URL: 'http://127.0.0.1:19001',
    TRIPS_BASE_URL: 'http://127.0.0.1:19002',
    PAYMENTS_BASE_URL: 'http://127.0.0.1:19003',
    ADMIN_BASE_URL: 'http://127.0.0.1:19005',
    HTTP_TIMEOUT_MS: '3000',
    MAX_BODY_BYTES: '1048576',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_TIMEOUT_MS: '500',
    EVENTS_HMAC_SECRET: 'hmac-secret-for-non-test-at-least-32-chars!!',
  };
}

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function deleteEnv(keys: string[]): void {
  for (const k of keys) {
    delete process.env[k];
  }
}

describe('loadEnv', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = { ...process.env };
    resetEnvCache();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(saved)) {
      process.env[k] = v;
    }
  });

  describe('EVENTS_HMAC_SECRET', () => {
    it('fails in non-test when EVENTS_HMAC_SECRET is not explicitly set', () => {
      applyEnv(baselineEnv());
      process.env['NODE_ENV'] = 'development';
      deleteEnv(['EVENTS_HMAC_SECRET']);

      expect(() => loadEnv()).toThrow(
        'EVENTS_HMAC_SECRET must be explicitly set in non-test environments',
      );
    });
  });

  describe('ALLOWED_ORIGINS', () => {
    it('fails in production when ALLOWED_ORIGINS is wildcard', () => {
      applyEnv(baselineEnv());
      process.env['NODE_ENV'] = 'production';
      process.env['ALLOWED_ORIGINS'] = '*';

      expect(() => loadEnv()).toThrow('ALLOWED_ORIGINS must not be wildcard (*) in production');
    });
  });

  describe('test environment', () => {
    it('passes with EVENTS_HMAC_SECRET unset and ALLOWED_ORIGINS wildcard', () => {
      applyEnv(baselineEnv());
      process.env['NODE_ENV'] = 'test';
      deleteEnv(['EVENTS_HMAC_SECRET']);
      process.env['ALLOWED_ORIGINS'] = '*';

      const env = loadEnv();
      expect(env.NODE_ENV).toBe('test');
      expect(env.EVENTS_HMAC_SECRET).toBe('hmac-secret-for-dev-at-least-32-chars!!');
      expect(env.ALLOWED_ORIGINS).toEqual(['*']);
    });
  });
});
