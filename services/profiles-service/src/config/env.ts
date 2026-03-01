import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'production', 'test']).default('development');

const isNonTest = (): boolean => {
  const raw = process.env['NODE_ENV'] ?? 'development';
  return raw !== 'test';
};

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3006),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    JWT_ACCESS_SECRET: z.string().min(1),
    EVENTS_HMAC_SECRET: z.string().min(1).default('hmac-secret-for-dev-at-least-32-chars!!'),

    RATING_WINDOW_DAYS: z.coerce.number().int().positive().default(14),
  })
  .superRefine((_val, ctx) => {
    if (
      isNonTest() &&
      (!process.env['JWT_ACCESS_SECRET'] || process.env['JWT_ACCESS_SECRET'].length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET must be at least 32 characters in non-test environments',
      });
    }
    if (
      isNonTest() &&
      (!process.env['EVENTS_HMAC_SECRET'] || process.env['EVENTS_HMAC_SECRET'].length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EVENTS_HMAC_SECRET'],
        message: 'EVENTS_HMAC_SECRET must be at least 32 characters in non-test environments',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const flat = result.error.flatten().fieldErrors;
    if (isNonTest()) {
      console.error('Invalid environment variables:', JSON.stringify(flat, null, 2));
      process.exit(1);
    }
    throw new Error(`Invalid env: ${JSON.stringify(flat)}`);
  }

  cached = result.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
