import { Module } from '@nestjs/common';
import { NotificationsController } from './controllers/notifications.controller';
import { InternalEventsController } from './controllers/internal-events.controller';
import { EnqueueNotificationUseCase } from '../../application/enqueue-notification.usecase';
import { GetNotificationUseCase } from '../../application/get-notification.usecase';
import { CancelNotificationUseCase } from '../../application/cancel-notification.usecase';
import { HandlePaymentHoldPlacedHandler } from '../../application/handlers/handle-payment-hold-placed.handler';
import { HandlePaymentCapturedHandler } from '../../application/handlers/handle-payment-captured.handler';
import { HmacGuard } from './guards/hmac.guard';

@Module({
  controllers: [NotificationsController, InternalEventsController],
  providers: [
    EnqueueNotificationUseCase,
    GetNotificationUseCase,
    CancelNotificationUseCase,
    HandlePaymentHoldPlacedHandler,
    HandlePaymentCapturedHandler,
    HmacGuard,
  ],
})
export class NotificationsModule {}
