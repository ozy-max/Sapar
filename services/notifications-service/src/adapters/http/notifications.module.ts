import { Module } from '@nestjs/common';
import { NotificationsController } from './controllers/notifications.controller';
import { EnqueueNotificationUseCase } from '../../application/enqueue-notification.usecase';
import { GetNotificationUseCase } from '../../application/get-notification.usecase';
import { CancelNotificationUseCase } from '../../application/cancel-notification.usecase';

@Module({
  controllers: [NotificationsController],
  providers: [
    EnqueueNotificationUseCase,
    GetNotificationUseCase,
    CancelNotificationUseCase,
  ],
})
export class NotificationsModule {}
