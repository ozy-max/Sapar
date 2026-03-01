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

  async execute(intentId: string, traceId = ''): Promise<{ status: string }> {
    const env = loadEnv();

    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!row) throw new PaymentIntentNotFoundError();

        if (row.status !== 'CAPTURED') {
          throw new InvalidPaymentStateError(
            `Cannot refund: current status is ${row.status}`,
          );
        }

        try {
          await withTimeout(
            this.psp.refund(row.psp_intent_id!, row.amount_kgs),
            env.PSP_TIMEOUT_MS,
          );
        } catch (error) {
          this.logger.error(error, 'PSP refund failed');
          throw new PspUnavailableError();
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

        return { status: 'REFUNDED' };
      },
      { timeout: env.PSP_TIMEOUT_MS + 3000 },
    );
  }
}
