import { Counter } from 'prom-client';
import { registry } from './metrics.registry';

export const ratingsCreatedTotal = new Counter({
  name: 'ratings_created_total',
  help: 'Total ratings created by role',
  labelNames: ['role'] as const,
  registers: [registry],
});

export const ratingsRejectedTotal = new Counter({
  name: 'ratings_rejected_total',
  help: 'Total ratings rejected by reason',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const ratingAggregateUpdatedTotal = new Counter({
  name: 'rating_aggregate_updated_total',
  help: 'Total rating aggregate updates',
  registers: [registry],
});

export function recordRatingCreated(role: string): void {
  ratingsCreatedTotal.labels(role).inc();
}

export function recordRatingRejected(reason: string): void {
  ratingsRejectedTotal.labels(reason).inc();
}

export function recordAggregateUpdated(): void {
  ratingAggregateUpdatedTotal.inc();
}
