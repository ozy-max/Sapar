import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { ReceiptRepository } from '../adapters/db/receipt.repository';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { RECEIPT_ISSUER, ReceiptIssuer } from '../adapters/psp/psp.interface';
import { loadEnv, getBackoffSchedule } from '../config/env';

@Injectable()
export class ProcessReceiptsUseCase {
  private readonly logger = new Logger(ProcessReceiptsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receiptRepo: ReceiptRepository,
    private readonly intentRepo: PaymentIntentRepository,
    @Inject(RECEIPT_ISSUER) private readonly issuer: ReceiptIssuer,
  ) {}

  async processOnce(): Promise<number> {
    const env = loadEnv();
    const backoff = getBackoffSchedule();
    const maxRetries = env.RECEIPT_RETRY_N;
    let processed = 0;

    const dueIds = await this.receiptRepo.findDueIds();

    for (const receiptId of dueIds) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const row = await this.receiptRepo.lockById(receiptId, tx);
          if (!row) return;

          const intent = await this.intentRepo.findById(row.payment_intent_id);
          if (!intent) {
            this.logger.warn(
              `Receipt ${row.id}: intent ${row.payment_intent_id} not found`,
            );
            return;
          }

          const nextTry = row.try_count + 1;

          try {
            await this.issuer.issueReceipt(
              intent.id,
              intent.amountKgs,
              intent.currency,
            );
            await this.receiptRepo.markIssued(row.id, tx);
            this.logger.log(`Receipt ${row.id} issued on try ${nextTry}`);
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);

            if (nextTry >= maxRetries) {
              await this.receiptRepo.markFailedFinal(
                row.id,
                errorMsg,
                nextTry,
                tx,
              );
              this.logger.error(
                `Receipt ${row.id} reached max retries (${maxRetries}), marking FAILED_FINAL`,
              );
            } else {
              const delaySec =
                backoff[nextTry - 1] ?? backoff[backoff.length - 1]!;
              const nextRetryAt = new Date(Date.now() + delaySec * 1000);

              await this.receiptRepo.markRetry(
                row.id,
                nextTry,
                nextRetryAt,
                errorMsg,
                tx,
              );
              this.logger.warn(
                `Receipt ${row.id} failed try ${nextTry}, next retry at ${nextRetryAt.toISOString()}`,
              );
            }
          }
        });

        processed++;
      } catch (error) {
        this.logger.error(
          error,
          `Failed to process receipt ${receiptId}`,
        );
      }
    }

    return processed;
  }
}
