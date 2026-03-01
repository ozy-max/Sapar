/**
 * Runs before any test file is loaded (Jest setupFiles).
 * Provides default env vars so that loadEnv() in @Module decorators
 * succeeds at class-definition time. Individual tests override
 * specific values in beforeAll + resetEnvCache().
 */
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
process.env['IDENTITY_BASE_URL'] = 'http://127.0.0.1:19001';
process.env['TRIPS_BASE_URL'] = 'http://127.0.0.1:19002';
process.env['PAYMENTS_BASE_URL'] = 'http://127.0.0.1:19003';
process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19005';
process.env['HTTP_TIMEOUT_MS'] = '3000';
process.env['MAX_BODY_BYTES'] = '1048576';
