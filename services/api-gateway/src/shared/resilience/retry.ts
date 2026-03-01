export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 3000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  shouldRetry: (error: unknown, attempt: number) => boolean,
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= config.maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delayMs = jitteredDelay(attempt, config);
      onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/** Full jitter: uniform random in [0, min(cap, base * 2^attempt)] */
function jitteredDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, config.maxDelayMs);
  return Math.round(capped * Math.random());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
