import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { ReceiptRepository, ReceiptRow } from '../adapters/db/receipt.repository';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { RECEIPT_ISSUER, ReceiptIssuer } from '../adapters/psp/psp.interface';
import { loadEnv, getBackoffSchedule } from '../config/env';
import { PaymentIntent } from '@prisma/client';

export interface ReceiptProcessResult {
  total: number;
  issued: number;
  retried: number;
  failedFinal: number;
}

interface ClaimedReceipt {
  row: ReceiptRow;
  intent: PaymentIntent;
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
        const outcome = await this.processOneReceipt(receiptId, maxRetries, backoff);
        if (outcome === 'issued') result.issued++;
        else if (outcome === 'retried') result.retried++;
        else if (outcome === 'failed_final') result.failedFinal++;
        else continue;
        result.total++;
      } catch (error) {
        this.logger.error(error, `Failed to process receipt ${receiptId}`);
      }
    }

    return result;
  }

  private async processOneReceipt(
    receiptId: string,
    maxRetries: number,
    backoff: number[],
  ): Promise<'issued' | 'retried' | 'failed_final' | 'skipped'> {
    // Phase 1: Claim — short TX to lock receipt and set a claim window
    // (prevents other workers from picking it up during the external call)
    const claimed = await this.claimReceipt(receiptId);
    if (!claimed) return 'skipped';

    const nextTry = claimed.row.try_count + 1;

    // Phase 2: Issue — external call OUTSIDE any transaction
    try {
      await this.issuer.issueReceipt(
        claimed.intent.id,
        claimed.intent.amountKgs,
        claimed.intent.currency,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (nextTry >= maxRetries) {
        await this.prisma.$transaction(async (tx) => {
          await this.receiptRepo.markFailedFinal(claimed.row.id, errorMsg, nextTry, tx);
        });
        this.logger.error(
          `Receipt ${claimed.row.id} reached max retries (${maxRetries}), marking FAILED_FINAL`,
        );
        return 'failed_final';
      }

      const delaySec = backoff[nextTry - 1] ?? backoff[backoff.length - 1]!;
      const nextRetryAt = new Date(Date.now() + delaySec * 1000);
      await this.prisma.$transaction(async (tx) => {
        await this.receiptRepo.markRetry(claimed.row.id, nextTry, nextRetryAt, errorMsg, tx);
      });
      this.logger.warn(
        `Receipt ${claimed.row.id} failed try ${nextTry}, next retry at ${nextRetryAt.toISOString()}`,
      );
      return 'retried';
    }

    // Phase 3: Mark issued — short TX
    await this.prisma.$transaction(async (tx) => {
      await this.receiptRepo.markIssued(claimed.row.id, tx);
    });
    this.logger.log(`Receipt ${claimed.row.id} issued on try ${nextTry}`);
    return 'issued';
  }

  private async claimReceipt(receiptId: string): Promise<ClaimedReceipt | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.receiptRepo.lockById(receiptId, tx);
      if (!row) return null;

      const intent = await this.intentRepo.findById(row.payment_intent_id);
      if (!intent) {
        this.logger.warn(`Receipt ${row.id}: intent ${row.payment_intent_id} not found`);
        return null;
      }

      // Set claim window: other workers won't pick this receipt for 2 minutes.
      // If we crash before phase 3, the receipt becomes eligible again.
      const claimUntil = new Date(Date.now() + 120_000);
      await this.receiptRepo.claim(row.id, claimUntil, tx);

      return { row, intent };
    });
  }
}
