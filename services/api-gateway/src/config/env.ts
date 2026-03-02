import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'production', 'test']).default('development');

const isNonTest = (): boolean => {
  const raw = process.env['NODE_ENV'] ?? 'development';
  return raw !== 'test';
};

const booleanString = z
  .string()
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    IDENTITY_BASE_URL: z.string().url('IDENTITY_BASE_URL must be a valid URL'),
    TRIPS_BASE_URL: z.string().url('TRIPS_BASE_URL must be a valid URL'),
    PAYMENTS_BASE_URL: z.string().url('PAYMENTS_BASE_URL must be a valid URL'),
    ADMIN_BASE_URL: z.string().url('ADMIN_BASE_URL must be a valid URL'),
    PROFILES_BASE_URL: z
      .string()
      .url('PROFILES_BASE_URL must be a valid URL')
      .default('http://profiles-service:3006'),

    HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    BFF_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
    MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
    MAX_DOWNSTREAM_RESPONSE_BYTES: z.coerce.number().int().positive().default(5_242_880),

    CB_ROLLING_WINDOW_MS: z.coerce.number().int().positive().default(30_000),
    CB_ERROR_THRESHOLD_PERCENT: z.coerce.number().int().min(1).max(100).default(50),
    CB_MIN_REQUESTS: z.coerce.number().int().positive().default(20),
    CB_OPEN_DURATION_MS: z.coerce.number().int().positive().default(10_000),
    CB_HALF_OPEN_MAX_PROBES: z.coerce.number().int().positive().default(3),

    REDIS_URL: z.string().min(1).optional(),
    REDIS_TIMEOUT_MS: z.coerce.number().int().positive().default(500),

    TRUST_PROXY: booleanString,

    ALLOWED_ORIGINS: z
      .string()
      .default('*')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    RATE_IDENTITY_RPM: z.coerce.number().int().positive().default(60),
    RATE_TRIPS_RPM: z.coerce.number().int().positive().default(120),
    RATE_PAYMENTS_RPM: z.coerce.number().int().positive().default(30),
    RATE_ADMIN_RPM: z.coerce.number().int().positive().default(60),
    RATE_PROFILES_RPM: z.coerce.number().int().positive().default(100),
    RATE_BFF_RPM: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),

    EVENTS_HMAC_SECRET: z.string().min(32).default('hmac-secret-for-dev-at-least-32-chars!!'),
  })
  .superRefine((_val, ctx) => {
    if (isNonTest() && !process.env['HTTP_TIMEOUT_MS']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HTTP_TIMEOUT_MS'],
        message: 'HTTP_TIMEOUT_MS is required in non-test environments',
      });
    }
    if (isNonTest() && !process.env['MAX_BODY_BYTES']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_BODY_BYTES'],
        message: 'MAX_BODY_BYTES is required in non-test environments',
      });
    }
    if (isNonTest() && !process.env['REDIS_URL']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required in non-test environments',
      });
    }
    if (isNonTest() && !process.env['REDIS_TIMEOUT_MS']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_TIMEOUT_MS'],
        message: 'REDIS_TIMEOUT_MS is required in non-test environments',
      });
    }
    if (isNonTest() && !process.env['EVENTS_HMAC_SECRET']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EVENTS_HMAC_SECRET'],
        message: 'EVENTS_HMAC_SECRET must be explicitly set in non-test environments',
      });
    }
    const isProd = (process.env['NODE_ENV'] ?? 'development') === 'production';
    const origins = process.env['ALLOWED_ORIGINS'];
    if (isProd && (!origins || origins.trim() === '*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALLOWED_ORIGINS'],
        message: 'ALLOWED_ORIGINS must not be wildcard (*) in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
