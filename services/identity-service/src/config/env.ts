import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'production', 'test']).default('development');

const isNonTest = (): boolean => {
  const raw = process.env['NODE_ENV'] ?? 'development';
  return raw !== 'test';
};

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2_592_000),

    PASSWORD_HASH_MEMORY_COST: z.coerce.number().int().positive().optional(),
    PASSWORD_HASH_TIME_COST: z.coerce.number().int().positive().optional(),

    EVENTS_HMAC_SECRET: z.string().min(1).default('hmac-secret-for-dev-at-least-32-chars!!'),

    ADMIN_BASE_URL: z.string().min(1).default('http://admin-service:3005'),
    COMMAND_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    COMMAND_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

    CONFIG_BASE_URL: z.string().min(1).default('http://admin-service:3005'),
    CONFIG_CACHE_TTL_MS: z.coerce.number().int().positive().default(30000),
    CONFIG_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
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
