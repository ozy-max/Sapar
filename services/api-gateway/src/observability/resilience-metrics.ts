import { CircuitBreakerListener, CircuitState } from '../shared/resilience/circuit-breaker';
import { SERVICE_NAME, circuitBreakerState, circuitBreakerOpenTotal } from './metrics.registry';

const STATES: readonly CircuitState[] = ['CLOSED', 'OPEN', 'HALF_OPEN'] as const;

function stateLabel(s: CircuitState): string {
  return s.toLowerCase();
}

export const gatewayBreakerListener: CircuitBreakerListener = {
  onStateChange(name: string, _from: CircuitState, to: CircuitState): void {
    for (const s of STATES) {
      circuitBreakerState.labels(SERVICE_NAME, name, stateLabel(s)).set(s === to ? 1 : 0);
    }

    if (to === 'OPEN') {
      circuitBreakerOpenTotal.labels(SERVICE_NAME, name).inc();
    }
  },
};
