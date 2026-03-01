import { Module } from '@nestjs/common';
import { NotificationWorker } from './notification.worker';
import { OutboxWorker } from './outbox.worker';
import { ProcessNotificationsUseCase } from '../application/process-notifications.usecase';

@Module({
  providers: [NotificationWorker, OutboxWorker, ProcessNotificationsUseCase],
  exports: [NotificationWorker, OutboxWorker, ProcessNotificationsUseCase],
})
export class WorkersModule {}
