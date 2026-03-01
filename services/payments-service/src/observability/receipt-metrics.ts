import { receiptStatusTotal } from './metrics.registry';

export type ReceiptOutcome = 'issued' | 'pending' | 'failed_final';

export function recordReceiptStatus(status: ReceiptOutcome, count = 1): void {
  receiptStatusTotal.labels(status).inc(count);
}
