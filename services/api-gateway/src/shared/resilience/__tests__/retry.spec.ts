import { withRetry, RetryConfig } from '../retry';

const fastConfig: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 10,
};

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, fastConfig, () => true);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure then succeeds', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('fail1')).mockResolvedValue('ok');

    const result = await withRetry(fn, fastConfig, () => true);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always-fail'));
    await expect(withRetry(fn, fastConfig, () => true)).rejects.toThrow('always-fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));
    await expect(withRetry(fn, fastConfig, () => false)).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');

    const onRetry = jest.fn();
    await withRetry(fn, fastConfig, () => true, onRetry);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
  });

  it('respects maxAttempts = 1 (no retries)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const noRetryConfig: RetryConfig = { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 10 };

    await expect(withRetry(fn, noRetryConfig, () => true)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
