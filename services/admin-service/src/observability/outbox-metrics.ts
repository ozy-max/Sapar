import { registry } from './metrics.registry';
import { Counter, Histogram } from 'prom-client';

const outboxEventsTotal = new Counter({
  name: 'admin_outbox_events_total',
  help: 'Total outbox events by type and status',
  labelNames: ['event_type', 'status'] as const,
  registers: [registry],
});

const outboxDeliveryDuration = new Histogram({
  name: 'admin_outbox_delivery_duration_ms',
  help: 'Outbox event delivery latency',
  labelNames: ['target'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

const outboxDeliveryErrors = new Counter({
  name: 'admin_outbox_delivery_errors_total',
  help: 'Outbox delivery errors',
  labelNames: ['target'] as const,
  registers: [registry],
});

export function recordOutboxEvent(eventType: string, status: string): void {
  outboxEventsTotal.inc({ event_type: eventType, status });
}

export function recordOutboxDelivery(target: string, latencyMs: number): void {
  outboxDeliveryDuration.observe({ target }, latencyMs);
}

export function recordOutboxDeliveryError(target: string): void {
  outboxDeliveryErrors.inc({ target });
}
