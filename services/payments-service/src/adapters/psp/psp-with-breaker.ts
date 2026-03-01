import { PspAdapter, PlaceHoldResult } from './psp.interface';
import { CircuitBreaker } from '../../shared/circuit-breaker';

export class PspWithCircuitBreaker implements PspAdapter {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly inner: PspAdapter,
    failureThreshold = 5,
    resetTimeoutMs = 30_000,
  ) {
    this.breaker = new CircuitBreaker({
      name: 'PSP',
      failureThreshold,
      resetTimeoutMs,
    });
  }

  placeHold(
    amount: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<PlaceHoldResult> {
    return this.breaker.execute(() =>
      this.inner.placeHold(amount, currency, metadata),
    );
  }

  capture(pspIntentId: string): Promise<void> {
    return this.breaker.execute(() => this.inner.capture(pspIntentId));
  }

  cancelHold(pspIntentId: string): Promise<void> {
    return this.breaker.execute(() => this.inner.cancelHold(pspIntentId));
  }

  refund(pspIntentId: string, amount?: number): Promise<void> {
    return this.breaker.execute(() => this.inner.refund(pspIntentId, amount));
  }

  getStatus(pspIntentId: string): Promise<{ status: string }> {
    return this.breaker.execute(() => this.inner.getStatus(pspIntentId));
  }
}
