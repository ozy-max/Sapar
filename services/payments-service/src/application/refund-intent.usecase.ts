import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { OutboxService } from '../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../adapters/psp/psp.interface';
import { loadEnv } from '../config/env';
import { withTimeout } from '../shared/psp-timeout';
import {
  PaymentIntentNotFoundError,
  InvalidPaymentStateError,
  PspUnavailableError,
  ForbiddenPaymentError,
  DataCorruptionError,
} from '../shared/errors';

@Injectable()
export class RefundIntentUseCase {
  private readonly logger = new Logger(RefundIntentUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async execute(intentId: string, userId: string, traceId = ''): Promise<{ status: string }> {
    const env = loadEnv();

    const row = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!locked) throw new PaymentIntentNotFoundError();
        if (locked.payer_id !== userId) throw new ForbiddenPaymentError();
        if (locked.status !== 'CAPTURED') {
          throw new InvalidPaymentStateError(`Cannot refund: current status is ${locked.status}`);
        }
        if (!locked.psp_intent_id) {
          throw new DataCorruptionError(`Payment intent ${locked.id} missing psp_intent_id`);
        }
        return locked;
      },
      { timeout: 5000 },
    );

    try {
      await withTimeout(this.psp.refund(row.psp_intent_id!, row.amount_kgs), env.PSP_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(error, 'PSP refund failed');
      throw new PspUnavailableError();
    }

    await this.prisma.$transaction(
      async (tx) => {
        const current = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!current || current.status !== 'CAPTURED') {
          this.logger.warn({
            msg: 'Intent state changed after PSP refund',
            intentId,
            expected: 'CAPTURED',
            actual: current?.status,
          });
          return;
        }

        await this.intentRepo.updateStatus(intentId, 'REFUNDED', tx);
        await this.eventRepo.create(
          {
            paymentIntentId: intentId,
            type: 'REFUNDED',
            payloadJson: { pspIntentId: row.psp_intent_id },
          },
          tx,
        );
        await this.outboxService.publish(
          {
            eventType: 'payment.refunded',
            payload: {
              paymentIntentId: intentId,
              bookingId: row.booking_id,
              amountKgs: row.amount_kgs,
            },
            traceId,
          },
          tx,
        );
      },
      { timeout: 5000 },
    );

    return { status: 'REFUNDED' };
  }
}
