import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { PSP_ADAPTER, PspAdapter } from '../adapters/psp/psp.interface';
import { loadEnv } from '../config/env';
import { withTimeout } from '../shared/psp-timeout';
import {
  PaymentIntentNotFoundError,
  InvalidPaymentStateError,
  PspUnavailableError,
} from '../shared/errors';

@Injectable()
export class CancelIntentUseCase {
  private readonly logger = new Logger(CancelIntentUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async execute(intentId: string): Promise<{ status: string }> {
    const env = loadEnv();

    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!row) throw new PaymentIntentNotFoundError();

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

        return { status: 'CANCELLED' };
      },
      { timeout: env.PSP_TIMEOUT_MS + 3000 },
    );
  }
}
