import { Module } from '@nestjs/common';
import { NotificationWorker } from './notification.worker';
import { ProcessNotificationsUseCase } from '../application/process-notifications.usecase';

@Module({
  providers: [NotificationWorker, ProcessNotificationsUseCase],
  exports: [NotificationWorker, ProcessNotificationsUseCase],
})
export class WorkersModule {}
