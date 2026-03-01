import { Counter, Histogram } from 'prom-client';
import { registry } from './metrics.registry';

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export const outboxEventsTotal = new Counter({
  name: 'outbox_events_total',
  help: 'Total outbox events by event type and status',
  labelNames: ['eventType', 'status'] as const,
  registers: [registry],
});

export const outboxDeliveryDurationMs = new Histogram({
  name: 'outbox_delivery_duration_ms',
  help: 'Outbox event delivery duration in milliseconds',
  labelNames: ['target'] as const,
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const outboxDeliveryErrorsTotal = new Counter({
  name: 'outbox_delivery_errors_total',
  help: 'Total outbox delivery errors',
  labelNames: ['target'] as const,
  registers: [registry],
});

export const consumerEventsTotal = new Counter({
  name: 'consumer_events_total',
  help: 'Total consumed events by event type and result',
  labelNames: ['eventType', 'result'] as const,
  registers: [registry],
});

export function recordOutboxEvent(eventType: string, status: string): void {
  outboxEventsTotal.inc({ eventType, status });
}

export function recordOutboxDelivery(target: string, durationMs: number): void {
  outboxDeliveryDurationMs.observe({ target }, durationMs);
}

export function recordOutboxDeliveryError(target: string): void {
  outboxDeliveryErrorsTotal.inc({ target });
}

export function recordConsumerEvent(eventType: string, result: string): void {
  consumerEventsTotal.inc({ eventType, result });
}
