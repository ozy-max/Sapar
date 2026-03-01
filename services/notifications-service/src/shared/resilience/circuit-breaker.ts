export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  readonly name: string;
  readonly rollingWindowMs: number;
  readonly errorThresholdPercent: number;
  readonly minimumRequests: number;
  readonly openDurationMs: number;
  readonly halfOpenMaxProbes: number;
}

export const DEFAULT_CB_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  rollingWindowMs: 30_000,
  errorThresholdPercent: 50,
  minimumRequests: 20,
  openDurationMs: 10_000,
  halfOpenMaxProbes: 3,
};

export interface CircuitBreakerListener {
  onStateChange(name: string, from: CircuitState, to: CircuitState): void;
}

interface Bucket {
  epochSec: number;
  total: number;
  errors: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private readonly buckets: Bucket[];
  private readonly windowSec: number;
  private openedAt = 0;
  private halfOpenSuccesses = 0;
  private halfOpenInFlight = false;
  private readonly now: () => number;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly listener?: CircuitBreakerListener,
    nowFn?: () => number,
  ) {
    this.windowSec = Math.max(1, Math.ceil(config.rollingWindowMs / 1000));
    this.buckets = Array.from({ length: this.windowSec }, () => ({
      epochSec: 0,
      total: 0,
      errors: 0,
    }));
    this.now = nowFn ?? (() => Date.now());
  }

  async execute<T>(
    fn: () => Promise<T>,
    opts?: { traceId?: string; isSuccess?: (result: T) => boolean },
  ): Promise<T> {
    this.assertNotOpen();

    try {
      const result = await fn();
      if (opts?.isSuccess && !opts.isSuccess(result)) {
        this.recordFailure();
      } else {
        this.recordSuccess();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      const elapsed = this.now() - this.openedAt;
      if (elapsed >= this.config.openDurationMs) {
        return 'HALF_OPEN';
      }
    }
    return this.state;
  }

  getName(): string {
    return this.config.name;
  }

  private assertNotOpen(): void {
    if (this.state === 'OPEN') {
      const elapsed = this.now() - this.openedAt;
      if (elapsed >= this.config.openDurationMs) {
        this.transition('HALF_OPEN');
        this.halfOpenSuccesses = 0;
        this.halfOpenInFlight = false;
      } else {
        throw new CircuitOpenError(this.config.name);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenInFlight) {
      throw new CircuitOpenError(this.config.name);
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenInFlight = true;
    }
  }

  private recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenInFlight = false;
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxProbes) {
        this.transition('CLOSED');
      }
    } else {
      this.currentBucket().total++;
    }
  }

  private recordFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenInFlight = false;
      this.transition('OPEN');
      return;
    }

    const bucket = this.currentBucket();
    bucket.total++;
    bucket.errors++;
    this.evaluateThreshold();
  }

  private evaluateThreshold(): void {
    if (this.state !== 'CLOSED') return;

    const stats = this.windowStats();
    if (stats.total < this.config.minimumRequests) return;

    const errorPct = (stats.errors / stats.total) * 100;
    if (errorPct >= this.config.errorThresholdPercent) {
      this.transition('OPEN');
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;

    if (to === 'OPEN') {
      this.openedAt = this.now();
    }

    if (to === 'CLOSED') {
      this.resetBuckets();
    }

    this.listener?.onStateChange(this.config.name, from, to);
  }

  private currentBucket(): Bucket {
    const sec = Math.floor(this.now() / 1000);
    const idx = sec % this.windowSec;
    const bucket = this.buckets[idx]!;

    if (bucket.epochSec !== sec) {
      bucket.epochSec = sec;
      bucket.total = 0;
      bucket.errors = 0;
    }

    return bucket;
  }

  private windowStats(): { total: number; errors: number } {
    const nowSec = Math.floor(this.now() / 1000);
    let total = 0;
    let errors = 0;

    for (const bucket of this.buckets) {
      if (nowSec - bucket.epochSec < this.windowSec) {
        total += bucket.total;
        errors += bucket.errors;
      }
    }

    return { total, errors };
  }

  private resetBuckets(): void {
    for (const bucket of this.buckets) {
      bucket.epochSec = 0;
      bucket.total = 0;
      bucket.errors = 0;
    }
  }
}

export class CircuitOpenError extends Error {
  public readonly target: string;

  constructor(target: string) {
    super(`Circuit breaker '${target}' is OPEN — fast-failing`);
    this.name = 'CircuitOpenError';
    this.target = target;
  }
}
