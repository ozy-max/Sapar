import { notificationOutcomeTotal } from './metrics.registry';

export type NotificationOutcome = 'sent' | 'retry' | 'failed_final';
export type NotificationChannel = 'sms' | 'email' | 'push';

export function recordNotificationOutcome(
  channel: NotificationChannel,
  status: NotificationOutcome,
  count = 1,
): void {
  notificationOutcomeTotal.labels(channel, status).inc(count);
}
