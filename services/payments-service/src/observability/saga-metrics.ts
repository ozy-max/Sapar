import { Counter } from 'prom-client';
import { registry } from './metrics.registry';

export const sagaOutcomesTotal = new Counter({
  name: 'saga_outcomes_total',
  help: 'Saga step outcomes by service, step, and result',
  labelNames: ['service', 'step', 'result'] as const,
  registers: [registry],
});

export const paymentCompensationsTotal = new Counter({
  name: 'payment_compensations_total',
  help: 'Payment compensation operations by type',
  labelNames: ['type'] as const,
  registers: [registry],
});

export function recordSagaOutcome(service: string, step: string, result: string): void {
  sagaOutcomesTotal.inc({ service, step, result });
}

export function recordPaymentCompensation(type: string): void {
  paymentCompensationsTotal.inc({ type });
}
