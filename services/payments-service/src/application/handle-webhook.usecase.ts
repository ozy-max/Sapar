import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { loadEnv } from '../config/env';
import {
  WebhookSignatureInvalidError,
  PaymentIntentNotFoundError,
} from '../shared/errors';
import { PaymentEventType, Prisma } from '@prisma/client';
import { canTransition, PaymentIntentStatus } from '../domain/payment-intent.entity';

export interface WebhookPayload {
  eventId: string;
  type: string;
  pspIntentId: string;
  data?: Record<string, unknown>;
}

const WEBHOOK_TYPE_MAP: Record<string, { intentStatus: PaymentIntentStatus; eventType: PaymentEventType }> = {
  'hold.succeeded': { intentStatus: PaymentIntentStatus.HOLD_PLACED, eventType: 'HOLD_PLACED' },
  'capture.succeeded': { intentStatus: PaymentIntentStatus.CAPTURED, eventType: 'CAPTURED' },
  'hold.failed': { intentStatus: PaymentIntentStatus.FAILED, eventType: 'FAILED' },
  'capture.failed': { intentStatus: PaymentIntentStatus.FAILED, eventType: 'FAILED' },
  'refund.succeeded': { intentStatus: PaymentIntentStatus.REFUNDED, eventType: 'REFUNDED' },
};

@Injectable()
export class HandleWebhookUseCase {
  private readonly logger = new Logger(HandleWebhookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
  ) {}

  verifySignature(rawBody: Buffer, signature: string): void {
    const env = loadEnv();
    const expected = createHmac('sha256', env.PAYMENTS_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new WebhookSignatureInvalidError();
    }
  }

  async execute(payload: WebhookPayload): Promise<void> {
    const alreadyProcessed = await this.eventRepo.existsByExternalEventId(
      payload.eventId,
    );
    if (alreadyProcessed) {
      this.logger.log(`Webhook event ${payload.eventId} already processed, skipping`);
      return;
    }

    const mapping = WEBHOOK_TYPE_MAP[payload.type];
    if (!mapping) {
      this.logger.warn(`Unknown webhook type: ${payload.type}, recording as event only`);
      await this.eventRepo.create({
        paymentIntentId: await this.resolveIntentId(payload.pspIntentId),
        type: 'WEBHOOK_RECEIVED',
        externalEventId: payload.eventId,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      });
      return;
    }

    const intent = await this.intentRepo.findByPspIntentId(payload.pspIntentId);
    if (!intent) {
      throw new PaymentIntentNotFoundError();
    }

    const currentStatus = intent.status as PaymentIntentStatus;
    if (currentStatus === mapping.intentStatus) {
      await this.eventRepo.create({
        paymentIntentId: intent.id,
        type: 'WEBHOOK_RECEIVED',
        externalEventId: payload.eventId,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      });
      return;
    }

    if (!canTransition(currentStatus, mapping.intentStatus)) {
      this.logger.warn(
        `Webhook ${payload.eventId}: cannot transition ${currentStatus} -> ${mapping.intentStatus}`,
      );
      await this.eventRepo.create({
        paymentIntentId: intent.id,
        type: 'WEBHOOK_RECEIVED',
        externalEventId: payload.eventId,
        payloadJson: { ...payload, skipped: true } as unknown as Prisma.InputJsonValue,
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.intentRepo.updateStatus(intent.id, mapping.intentStatus, tx);
      await this.eventRepo.create(
        {
          paymentIntentId: intent.id,
          type: mapping.eventType,
          externalEventId: payload.eventId,
          payloadJson: payload as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    });
  }

  private async resolveIntentId(pspIntentId: string): Promise<string> {
    const intent = await this.intentRepo.findByPspIntentId(pspIntentId);
    if (!intent) throw new PaymentIntentNotFoundError();
    return intent.id;
  }
}
