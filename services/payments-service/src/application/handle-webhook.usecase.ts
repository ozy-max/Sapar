import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { loadEnv } from '../config/env';
import { WebhookSignatureInvalidError, PaymentIntentNotFoundError } from '../shared/errors';
import { PaymentEventType, Prisma } from '@prisma/client';
import { canTransition, PaymentIntentStatus } from '../domain/payment-intent.entity';

export interface WebhookPayload {
  eventId: string;
  type: string;
  pspIntentId: string;
  data?: Record<string, unknown>;
}

const WEBHOOK_TYPE_MAP: Record<
  string,
  { intentStatus: PaymentIntentStatus; eventType: PaymentEventType }
> = {
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

  verifySignature(rawBody: Buffer, signature: string, timestamp?: string): void {
    const env = loadEnv();
    const expected = createHmac('sha256', env.PAYMENTS_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    // Both signature and expected are hex-encoded strings (ASCII subset of UTF-8).
    // Comparing as UTF-8 buffers is correct for timing-safe hex comparison.
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new WebhookSignatureInvalidError();
    }

    if (!timestamp && process.env.NODE_ENV !== 'test') {
      throw new WebhookSignatureInvalidError();
    }

    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      const maxAge = 300; // 5 minutes
      if (isNaN(ts) || Math.abs(now - ts) > maxAge) {
        throw new WebhookSignatureInvalidError();
      }
    }
  }

  async execute(payload: WebhookPayload): Promise<void> {
    const alreadyProcessed = await this.eventRepo.existsByExternalEventId(payload.eventId);
    if (alreadyProcessed) {
      this.logger.log(`Webhook event ${payload.eventId} already processed, skipping`);
      return;
    }

    try {
      const mapping = WEBHOOK_TYPE_MAP[payload.type];
      if (!mapping) {
        this.logger.warn({
          msg: 'Unknown webhook event type, ignoring',
          type: payload.type,
          pspIntentId: payload.pspIntentId,
        });
        return;
      }

      // All state reads and updates happen inside a single TX with FOR UPDATE
      // to prevent TOCTOU races between concurrent webhooks.
      await this.prisma.$transaction(
        async (tx) => {
          const locked = await this.intentRepo.findByPspIntentIdForUpdate(payload.pspIntentId, tx);
          if (!locked) {
            throw new PaymentIntentNotFoundError();
          }

          const currentStatus = locked.status as PaymentIntentStatus;

          if (currentStatus === mapping.intentStatus) {
            await this.eventRepo.create(
              {
                paymentIntentId: locked.id,
                type: 'WEBHOOK_RECEIVED',
                externalEventId: payload.eventId,
                payloadJson: payload as unknown as Prisma.InputJsonValue,
              },
              tx,
            );
            return;
          }

          if (!canTransition(currentStatus, mapping.intentStatus)) {
            this.logger.warn(
              `Webhook ${payload.eventId}: cannot transition ${currentStatus} -> ${mapping.intentStatus}`,
            );
            await this.eventRepo.create(
              {
                paymentIntentId: locked.id,
                type: 'WEBHOOK_RECEIVED',
                externalEventId: payload.eventId,
                payloadJson: {
                  ...payload,
                  skipped: true,
                } as unknown as Prisma.InputJsonValue,
              },
              tx,
            );
            return;
          }

          await this.intentRepo.updateStatus(locked.id, mapping.intentStatus, tx);
          await this.eventRepo.create(
            {
              paymentIntentId: locked.id,
              type: mapping.eventType,
              externalEventId: payload.eventId,
              payloadJson: payload as unknown as Prisma.InputJsonValue,
            },
            tx,
          );
        },
        { timeout: 10_000 },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(
          `Webhook event ${payload.eventId} duplicate (concurrent), treating as idempotent`,
        );
        return;
      }
      throw error;
    }
  }
}
