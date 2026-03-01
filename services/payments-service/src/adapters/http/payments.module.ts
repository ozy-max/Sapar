import { Module } from '@nestjs/common';
import { IntentsController } from './controllers/intents.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { InternalEventsController } from './controllers/internal-events.controller';
import { CreateIntentUseCase } from '../../application/create-intent.usecase';
import { CaptureIntentUseCase } from '../../application/capture-intent.usecase';
import { CancelIntentUseCase } from '../../application/cancel-intent.usecase';
import { RefundIntentUseCase } from '../../application/refund-intent.usecase';
import { HandleWebhookUseCase } from '../../application/handle-webhook.usecase';
import { HandleBookingCreatedHandler } from '../../application/handlers/handle-booking-created.handler';
import { HmacGuard } from './guards/hmac.guard';

@Module({
  controllers: [IntentsController, WebhooksController, InternalEventsController],
  providers: [
    CreateIntentUseCase,
    CaptureIntentUseCase,
    CancelIntentUseCase,
    RefundIntentUseCase,
    HandleWebhookUseCase,
    HandleBookingCreatedHandler,
    HmacGuard,
  ],
})
export class PaymentsModule {}
