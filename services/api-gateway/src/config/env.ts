import { z } from 'zod';

const nodeEnvSchema = z
  .enum(['development', 'production', 'test'])
  .default('development');

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
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),

    IDENTITY_BASE_URL: z.string().url('IDENTITY_BASE_URL must be a valid URL'),
    TRIPS_BASE_URL: z.string().url('TRIPS_BASE_URL must be a valid URL'),
    PAYMENTS_BASE_URL: z.string().url('PAYMENTS_BASE_URL must be a valid URL'),

    HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),

    REDIS_URL: z.string().min(1).optional(),
    REDIS_TIMEOUT_MS: z.coerce.number().int().positive().default(500),

    TRUST_PROXY: booleanString,

    RATE_IDENTITY_RPM: z.coerce.number().int().positive().default(60),
    RATE_TRIPS_RPM: z.coerce.number().int().positive().default(120),
    RATE_PAYMENTS_RPM: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
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
