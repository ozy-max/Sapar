import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { ReceiptRepository } from '../adapters/db/receipt.repository';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { RECEIPT_ISSUER, ReceiptIssuer } from '../adapters/psp/psp.interface';
import { loadEnv, getBackoffSchedule } from '../config/env';

export interface ReceiptProcessResult {
  total: number;
  issued: number;
  retried: number;
  failedFinal: number;
}

@Injectable()
export class ProcessReceiptsUseCase {
  private readonly logger = new Logger(ProcessReceiptsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receiptRepo: ReceiptRepository,
    private readonly intentRepo: PaymentIntentRepository,
    @Inject(RECEIPT_ISSUER) private readonly issuer: ReceiptIssuer,
  ) {}

  async processOnce(): Promise<ReceiptProcessResult> {
    const env = loadEnv();
    const backoff = getBackoffSchedule();
    const maxRetries = env.RECEIPT_RETRY_N;
    const result: ReceiptProcessResult = { total: 0, issued: 0, retried: 0, failedFinal: 0 };

    const dueIds = await this.receiptRepo.findDueIds(env.RECEIPT_BATCH_SIZE);

    for (const receiptId of dueIds) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const row = await this.receiptRepo.lockById(receiptId, tx);
          if (!row) return;

          const intent = await this.intentRepo.findById(row.payment_intent_id);
          if (!intent) {
            this.logger.warn(`Receipt ${row.id}: intent ${row.payment_intent_id} not found`);
            return;
          }

          const nextTry = row.try_count + 1;

          try {
            await this.issuer.issueReceipt(intent.id, intent.amountKgs, intent.currency);
            await this.receiptRepo.markIssued(row.id, tx);
            result.issued++;
            this.logger.log(`Receipt ${row.id} issued on try ${nextTry}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            if (nextTry >= maxRetries) {
              await this.receiptRepo.markFailedFinal(row.id, errorMsg, nextTry, tx);
              result.failedFinal++;
              this.logger.error(
                `Receipt ${row.id} reached max retries (${maxRetries}), marking FAILED_FINAL`,
              );
            } else {
              const delaySec = backoff[nextTry - 1] ?? backoff[backoff.length - 1]!;
              const nextRetryAt = new Date(Date.now() + delaySec * 1000);

              await this.receiptRepo.markRetry(row.id, nextTry, nextRetryAt, errorMsg, tx);
              result.retried++;
              this.logger.warn(
                `Receipt ${row.id} failed try ${nextTry}, next retry at ${nextRetryAt.toISOString()}`,
              );
            }
          }
        });

        result.total++;
      } catch (error) {
        this.logger.error(error, `Failed to process receipt ${receiptId}`);
      }
    }

    return result;
  }
}
