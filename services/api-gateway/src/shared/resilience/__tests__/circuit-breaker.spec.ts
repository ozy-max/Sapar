import { CircuitBreaker, CircuitOpenError, CircuitBreakerConfig } from '../circuit-breaker';

function makeConfig(overrides: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return {
    name: 'test',
    rollingWindowMs: 10_000,
    errorThresholdPercent: 50,
    minimumRequests: 4,
    openDurationMs: 5_000,
    halfOpenMaxProbes: 2,
    ...overrides,
  };
}

describe('CircuitBreaker', () => {
  let now: number;
  const tick = (ms: number): void => {
    now += ms;
  };

  beforeEach(() => {
    now = 1_000_000;
  });

  function create(
    overrides: Partial<CircuitBreakerConfig> = {},
    listener?: { onStateChange: jest.Mock },
  ): CircuitBreaker {
    return new CircuitBreaker(makeConfig(overrides), listener, () => now);
  }

  it('starts in CLOSED state', () => {
    const cb = create();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('allows calls when CLOSED', async () => {
    const cb = create();
    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('stays CLOSED below threshold', async () => {
    const cb = create({ minimumRequests: 4, errorThresholdPercent: 50 });

    await cb.execute(async () => 'ok');
    tick(100);
    await expect(
      cb.execute(async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    tick(100);
    await cb.execute(async () => 'ok');
    tick(100);
    await cb.execute(async () => 'ok');

    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens when error threshold exceeded', async () => {
    const listener = { onStateChange: jest.fn() };
    const cb = create({ minimumRequests: 4, errorThresholdPercent: 50 }, listener);

    for (let i = 0; i < 2; i++) {
      tick(100);
      await cb.execute(async () => 'ok');
    }
    for (let i = 0; i < 3; i++) {
      tick(100);
      await expect(
        cb.execute(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();
    }

    expect(cb.getState()).toBe('OPEN');
    expect(listener.onStateChange).toHaveBeenCalledWith('test', 'CLOSED', 'OPEN');
  });

  it('fast-fails when OPEN', async () => {
    const cb = create({ minimumRequests: 2, errorThresholdPercent: 50 });

    await expect(
      cb.execute(async () => {
        throw new Error('e1');
      }),
    ).rejects.toThrow();
    tick(100);
    await expect(
      cb.execute(async () => {
        throw new Error('e2');
      }),
    ).rejects.toThrow();

    expect(cb.getState()).toBe('OPEN');
    await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after openDuration', async () => {
    const cb = create({ minimumRequests: 2, errorThresholdPercent: 50 });

    await expect(
      cb.execute(async () => {
        throw new Error('e1');
      }),
    ).rejects.toThrow();
    tick(100);
    await expect(
      cb.execute(async () => {
        throw new Error('e2');
      }),
    ).rejects.toThrow();

    expect(cb.getState()).toBe('OPEN');

    tick(5_000);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('closes after successful HALF_OPEN probes', async () => {
    const listener = { onStateChange: jest.fn() };
    const cb = create(
      { minimumRequests: 2, errorThresholdPercent: 50, halfOpenMaxProbes: 2 },
      listener,
    );

    await expect(
      cb.execute(async () => {
        throw new Error('e1');
      }),
    ).rejects.toThrow();
    tick(100);
    await expect(
      cb.execute(async () => {
        throw new Error('e2');
      }),
    ).rejects.toThrow();

    tick(5_000);

    const r1 = await cb.execute(async () => 'probe1');
    expect(r1).toBe('probe1');

    const r2 = await cb.execute(async () => 'probe2');
    expect(r2).toBe('probe2');

    expect(cb.getState()).toBe('CLOSED');
    expect(listener.onStateChange).toHaveBeenCalledWith('test', 'HALF_OPEN', 'CLOSED');
  });

  it('re-opens on HALF_OPEN failure', async () => {
    const cb = create({ minimumRequests: 2, errorThresholdPercent: 50 });

    await expect(
      cb.execute(async () => {
        throw new Error('e1');
      }),
    ).rejects.toThrow();
    tick(100);
    await expect(
      cb.execute(async () => {
        throw new Error('e2');
      }),
    ).rejects.toThrow();

    tick(5_000);
    await expect(
      cb.execute(async () => {
        throw new Error('probe-fail');
      }),
    ).rejects.toThrow('probe-fail');

    expect(cb.getState()).toBe('OPEN');
  });

  it('uses isSuccess callback for non-throwing failures', async () => {
    const cb = create({ minimumRequests: 2, errorThresholdPercent: 50 });

    await cb.execute(async () => 500, { isSuccess: (r) => r < 500 });
    tick(100);
    await cb.execute(async () => 500, { isSuccess: (r) => r < 500 });

    expect(cb.getState()).toBe('OPEN');
  });

  it('rolling window expires old buckets', async () => {
    const cb = create({
      minimumRequests: 4,
      errorThresholdPercent: 50,
      rollingWindowMs: 5_000,
    });

    for (let i = 0; i < 3; i++) {
      tick(100);
      await expect(
        cb.execute(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();
    }

    tick(6_000);

    for (let i = 0; i < 4; i++) {
      tick(100);
      await cb.execute(async () => 'ok');
    }

    expect(cb.getState()).toBe('CLOSED');
  });

  it('CircuitOpenError has correct target property', () => {
    const err = new CircuitOpenError('my-service');
    expect(err.target).toBe('my-service');
    expect(err.name).toBe('CircuitOpenError');
    expect(err.message).toContain('my-service');
  });
});
