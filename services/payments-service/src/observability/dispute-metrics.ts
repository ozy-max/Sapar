import { registry } from './metrics.registry';
import { Counter } from 'prom-client';

const disputesRefundTotal = new Counter({
  name: 'disputes_refund_total',
  help: 'Total dispute refunds by result',
  labelNames: ['result'] as const,
  registers: [registry],
});

const disputesRefundErrors = new Counter({
  name: 'disputes_refund_errors_total',
  help: 'Total dispute refund errors',
  registers: [registry],
});

export function recordDisputeRefund(result: string): void {
  disputesRefundTotal.inc({ result });
}

export function recordDisputeRefundError(): void {
  disputesRefundErrors.inc();
}
