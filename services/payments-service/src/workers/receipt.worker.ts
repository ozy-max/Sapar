import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';
import { loadEnv } from '../config/env';
import { recordReceiptStatus } from '../observability/receipt-metrics';

@Injectable()
export class ReceiptWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptWorker.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly processReceipts: ProcessReceiptsUseCase) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      this.logger.log('Receipt worker disabled in test environment');
      return;
    }

    this.logger.log(`Starting receipt worker, poll interval: ${env.RECEIPT_POLL_INTERVAL_MS}ms`);
    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, env.RECEIPT_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async tick(): Promise<void> {
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
    } catch (error) {
      this.logger.error(error, 'Receipt worker tick failed');
    } finally {
      this.running = false;
    }
  }
}
