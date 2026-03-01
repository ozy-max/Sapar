import { Counter } from 'prom-client';
import { registry } from './metrics.registry';

export const sagaOutcomesTotal = new Counter({
  name: 'saga_outcomes_total',
  help: 'Saga step outcomes by service, step, and result',
  labelNames: ['service', 'step', 'result'] as const,
  registers: [registry],
});

export const bookingStateTransitionsTotal = new Counter({
  name: 'booking_state_transitions_total',
  help: 'Booking state transitions by from and to status',
  labelNames: ['from', 'to'] as const,
  registers: [registry],
});

export const bookingExpiredTotal = new Counter({
  name: 'booking_expired_total',
  help: 'Total bookings expired by TTL worker',
  registers: [registry],
});

export function recordSagaOutcome(service: string, step: string, result: string): void {
  sagaOutcomesTotal.inc({ service, step, result });
}

export function recordBookingTransition(from: string, to: string): void {
  bookingStateTransitionsTotal.inc({ from, to });
}

export function recordBookingExpired(): void {
  bookingExpiredTotal.inc();
}
