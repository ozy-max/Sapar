import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ProcessNotificationsUseCase } from '../application/process-notifications.usecase';
import { loadEnv } from '../config/env';
import { recordNotificationOutcome, NotificationChannel } from '../observability/notification-metrics';

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly processNotifications: ProcessNotificationsUseCase) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      this.logger.log('Notification worker disabled in test environment');
      return;
    }

    this.logger.log(
      `Starting notification worker, poll interval: ${env.WORKER_INTERVAL_MS}ms`,
    );
    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, env.WORKER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.processNotifications.processOnce();

      for (const [ch, stats] of Object.entries(result.channels)) {
        const channel = ch as NotificationChannel;
        if (stats.sent > 0) recordNotificationOutcome(channel, 'sent', stats.sent);
        if (stats.retried > 0) recordNotificationOutcome(channel, 'retry', stats.retried);
        if (stats.failedFinal > 0) recordNotificationOutcome(channel, 'failed_final', stats.failedFinal);
      }

      if (result.total > 0) {
        this.logger.log(`Processed ${result.total} notification(s): sent=${result.sent}, retried=${result.retried}, failedFinal=${result.failedFinal}`);
      }
    } catch (error) {
      this.logger.error(error, 'Notification worker tick failed');
    } finally {
      this.running = false;
    }
  }
}
