import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ProcessNotificationsUseCase } from '../application/process-notifications.usecase';
import { loadEnv } from '../config/env';

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
      const count = await this.processNotifications.processOnce();
      if (count > 0) {
        this.logger.log(`Processed ${count} notification(s)`);
      }
    } catch (error) {
      this.logger.error(error, 'Notification worker tick failed');
    } finally {
      this.running = false;
    }
  }
}
