import { Module } from '@nestjs/common';
import { IntentsController } from './controllers/intents.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { CreateIntentUseCase } from '../../application/create-intent.usecase';
import { CaptureIntentUseCase } from '../../application/capture-intent.usecase';
import { CancelIntentUseCase } from '../../application/cancel-intent.usecase';
import { RefundIntentUseCase } from '../../application/refund-intent.usecase';
import { HandleWebhookUseCase } from '../../application/handle-webhook.usecase';

@Module({
  controllers: [IntentsController, WebhooksController],
  providers: [
    CreateIntentUseCase,
    CaptureIntentUseCase,
    CancelIntentUseCase,
    RefundIntentUseCase,
    HandleWebhookUseCase,
  ],
})
export class PaymentsModule {}
