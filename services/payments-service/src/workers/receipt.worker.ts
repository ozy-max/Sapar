import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';
import { loadEnv } from '../config/env';
import { recordReceiptStatus } from '../observability/receipt-metrics';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

@Injectable()
export class ReceiptWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptWorker.name);
  private timeoutHandle?: ReturnType<typeof setTimeout>;
  private running = false;
  private currentTick?: Promise<void>;
  private consecutiveFailures = 0;

  constructor(private readonly processReceipts: ProcessReceiptsUseCase) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      this.logger.log('Receipt worker disabled in test environment');
      return;
    }

    this.logger.log(`Starting receipt worker, poll interval: ${env.RECEIPT_POLL_INTERVAL_MS}ms`);
    this.scheduleTick(env.RECEIPT_POLL_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    if (this.currentTick) {
      await this.currentTick;
    }
  }

  private scheduleTick(delayMs: number): void {
    this.timeoutHandle = setTimeout(() => {
      this.currentTick = this.doTick();
    }, delayMs);
  }

  private getBackoffDelay(): number {
    if (this.consecutiveFailures === 0) return loadEnv().RECEIPT_POLL_INTERVAL_MS;
    const exponential = BASE_BACKOFF_MS * Math.pow(2, Math.min(this.consecutiveFailures - 1, 14));
    const capped = Math.min(exponential, MAX_BACKOFF_MS);
    const jitter = capped * (0.5 + Math.random() * 0.5);
    return Math.floor(jitter);
  }

  private async doTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.processReceipts.processOnce();
      if (result.issued > 0) recordReceiptStatus('issued', result.issued);
      if (result.retried > 0) recordReceiptStatus('pending', result.retried);
      if (result.failedFinal > 0) recordReceiptStatus('failed_final', result.failedFinal);
      if (result.total > 0) {
        this.logger.log(
          `Processed ${result.total} receipt(s): issued=${result.issued}, retried=${result.retried}, failedFinal=${result.failedFinal}`,
        );
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures++;
      this.logger.error(error, `Receipt worker tick failed (consecutive: ${this.consecutiveFailures})`);
    } finally {
      this.running = false;
      this.scheduleTick(this.getBackoffDelay());
    }
  }
}
