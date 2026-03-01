import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'production', 'test']).default('development');

const isNonTest = (): boolean => {
  const raw = process.env['NODE_ENV'] ?? 'development';
  return raw !== 'test';
};

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3005),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    JWT_ACCESS_SECRET: z.string().min(1),
    SLA_RESOLVE_HOURS: z.coerce.number().int().positive().default(12),

    EVENTS_HMAC_SECRET: z.string().min(1).default('hmac-secret-for-dev-at-least-32-chars!!'),

    OUTBOX_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_RETRY_N: z.coerce.number().int().positive().default(5),
    OUTBOX_BACKOFF_SEC_LIST: z.string().default('5,30,120,300,900'),
    OUTBOX_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    OUTBOX_TARGETS: z.string().default(''),

    COMMAND_MAX_RETRIES: z.coerce.number().int().positive().default(5),
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

export function getOutboxBackoffSchedule(): number[] {
  const env = loadEnv();
  const values = env.OUTBOX_BACKOFF_SEC_LIST.split(',').map((s) => {
    const n = parseInt(s.trim(), 10);
    if (isNaN(n) || n < 0) throw new Error(`Invalid OUTBOX_BACKOFF_SEC_LIST value: '${s.trim()}'`);
    return n;
  });
  if (values.length === 0)
    throw new Error('OUTBOX_BACKOFF_SEC_LIST must contain at least one value');
  return values;
}

export function parseOutboxTargets(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('>');
    if (idx === -1) continue;
    const eventType = pair.slice(0, idx).trim();
    const url = pair.slice(idx + 1).trim();
    if (eventType && url) map.set(eventType, url);
  }
  return map;
}
