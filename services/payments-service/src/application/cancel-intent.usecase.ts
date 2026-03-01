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
} from '../shared/errors';

@Injectable()
export class CancelIntentUseCase {
  private readonly logger = new Logger(CancelIntentUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async execute(intentId: string, userId: string, traceId = ''): Promise<{ status: string }> {
    const env = loadEnv();

    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!row) throw new PaymentIntentNotFoundError();
        if (row.payer_id !== userId) throw new ForbiddenPaymentError();

        const allowedStatuses = ['CREATED', 'HOLD_PLACED'];
        if (!allowedStatuses.includes(row.status)) {
          throw new InvalidPaymentStateError(
            `Cannot cancel: current status is ${row.status}`,
          );
        }

        if (row.psp_intent_id) {
          try {
            await withTimeout(
              this.psp.cancelHold(row.psp_intent_id),
              env.PSP_TIMEOUT_MS,
            );
          } catch (error) {
            this.logger.error(error, 'PSP cancelHold failed');
            throw new PspUnavailableError();
          }
        }

        await this.intentRepo.updateStatus(intentId, 'CANCELLED', tx);

        await this.eventRepo.create(
          {
            paymentIntentId: intentId,
            type: 'CANCELLED',
            payloadJson: {},
          },
          tx,
        );

        await this.outboxService.publish(
          {
            eventType: 'payment.cancelled',
            payload: {
              paymentIntentId: intentId,
              bookingId: row.booking_id,
            },
            traceId,
          },
          tx,
        );

        return { status: 'CANCELLED' };
      },
      { timeout: env.PSP_TIMEOUT_MS + 5000 },
    );
  }
}
