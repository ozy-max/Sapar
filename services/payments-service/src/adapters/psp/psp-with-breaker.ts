import { PspAdapter, PlaceHoldResult } from './psp.interface';
import {
  CircuitBreaker,
  DEFAULT_CB_CONFIG,
  CircuitBreakerListener,
  CircuitState,
} from '../../shared/resilience/circuit-breaker';
import {
  SERVICE_NAME,
  circuitBreakerState,
  circuitBreakerOpenTotal,
} from '../../observability/metrics.registry';

const STATES: readonly CircuitState[] = ['CLOSED', 'OPEN', 'HALF_OPEN'];

const pspBreakerListener: CircuitBreakerListener = {
  onStateChange(name: string, _from: CircuitState, to: CircuitState): void {
    for (const s of STATES) {
      circuitBreakerState.labels(SERVICE_NAME, name, s.toLowerCase()).set(s === to ? 1 : 0);
    }
    if (to === 'OPEN') {
      circuitBreakerOpenTotal.labels(SERVICE_NAME, name).inc();
    }
  },
};

export class PspWithCircuitBreaker implements PspAdapter {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly inner: PspAdapter,
    openDurationMs = 30_000,
  ) {
    this.breaker = new CircuitBreaker(
      {
        ...DEFAULT_CB_CONFIG,
        name: 'PSP',
        openDurationMs,
        minimumRequests: 10,
        errorThresholdPercent: 60,
      },
      pspBreakerListener,
    );
  }

  placeHold(
    amount: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<PlaceHoldResult> {
    return this.breaker.execute(() => this.inner.placeHold(amount, currency, metadata));
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
