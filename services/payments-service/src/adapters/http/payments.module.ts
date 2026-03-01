import { Module } from '@nestjs/common';
import { IntentsController } from './controllers/intents.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { InternalEventsController } from './controllers/internal-events.controller';
import { BffReadController } from './controllers/bff-read.controller';
import { CreateIntentUseCase } from '../../application/create-intent.usecase';
import { CaptureIntentUseCase } from '../../application/capture-intent.usecase';
import { CancelIntentUseCase } from '../../application/cancel-intent.usecase';
import { RefundIntentUseCase } from '../../application/refund-intent.usecase';
import { HandleWebhookUseCase } from '../../application/handle-webhook.usecase';
import { HandleBookingCreatedHandler } from '../../application/handlers/handle-booking-created.handler';
import { OnBookingConfirmedHandler } from '../../application/handlers/on-booking-confirmed.handler';
import { OnBookingCancelledHandler } from '../../application/handlers/on-booking-cancelled.handler';
import { OnDisputeResolvedHandler } from '../../application/handlers/on-dispute-resolved.handler';
import { HmacGuard } from './guards/hmac.guard';

@Module({
  controllers: [IntentsController, WebhooksController, InternalEventsController, BffReadController],
  providers: [
    CreateIntentUseCase,
    CaptureIntentUseCase,
    CancelIntentUseCase,
    RefundIntentUseCase,
    HandleWebhookUseCase,
    HandleBookingCreatedHandler,
    OnBookingConfirmedHandler,
    OnBookingCancelledHandler,
    OnDisputeResolvedHandler,
    HmacGuard,
  ],
})
export class PaymentsModule {}
