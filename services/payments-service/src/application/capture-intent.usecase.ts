import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { ReceiptRepository } from '../adapters/db/receipt.repository';
import { PSP_ADAPTER, PspAdapter } from '../adapters/psp/psp.interface';
import { loadEnv } from '../config/env';
import { withTimeout } from '../shared/psp-timeout';
import {
  PaymentIntentNotFoundError,
  InvalidPaymentStateError,
  PspUnavailableError,
} from '../shared/errors';

@Injectable()
export class CaptureIntentUseCase {
  private readonly logger = new Logger(CaptureIntentUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly receiptRepo: ReceiptRepository,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async execute(intentId: string): Promise<{ status: string }> {
    const env = loadEnv();

    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.intentRepo.findByIdForUpdate(intentId, tx);
        if (!row) throw new PaymentIntentNotFoundError();
        if (row.status !== 'HOLD_PLACED') {
          throw new InvalidPaymentStateError(
            `Cannot capture: current status is ${row.status}`,
          );
        }

        try {
          await withTimeout(this.psp.capture(row.psp_intent_id!), env.PSP_TIMEOUT_MS);
        } catch (error) {
          this.logger.error(error, 'PSP capture failed');
          throw new PspUnavailableError();
        }

        await this.intentRepo.updateStatus(intentId, 'CAPTURED', tx);

        await this.eventRepo.create(
          {
            paymentIntentId: intentId,
            type: 'CAPTURED',
            payloadJson: { pspIntentId: row.psp_intent_id },
          },
          tx,
        );

        await this.receiptRepo.create(intentId, tx);

        return { status: 'CAPTURED' };
      },
      { timeout: env.PSP_TIMEOUT_MS + 3000 },
    );
  }
}
