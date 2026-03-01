import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Headers,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { webhookSchema, WebhookInput } from '../dto/webhook.dto';
import { HandleWebhookUseCase } from '../../../application/handle-webhook.usecase';
import { WebhookSignatureInvalidError } from '../../../shared/errors';

@ApiTags('Webhooks')
@Controller('payments/webhooks')
export class WebhooksController {
  constructor(private readonly handleWebhook: HandleWebhookUseCase) {}

  @Post('psp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Handle PSP webhook callback' })
  @ApiHeader({ name: 'x-webhook-signature', required: true })
  @ApiResponse({ status: 204, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async psp(
    @Body(new ZodValidationPipe(webhookSchema)) _body: WebhookInput,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature?: string,
  ): Promise<void> {
    if (!signature) {
      throw new WebhookSignatureInvalidError();
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new WebhookSignatureInvalidError();
    }

    this.handleWebhook.verifySignature(rawBody, signature);

    const payload = req.body as WebhookInput;
    await this.handleWebhook.execute({
      eventId: payload.eventId,
      type: payload.type,
      pspIntentId: payload.pspIntentId,
      data: payload.data,
    });
  }
}
