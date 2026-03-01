import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';
import { loadEnv } from '../config/env';

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

    this.logger.log(
      `Starting receipt worker, poll interval: ${env.RECEIPT_POLL_INTERVAL_MS}ms`,
    );
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
      const count = await this.processReceipts.processOnce();
      if (count > 0) {
        this.logger.log(`Processed ${count} receipt(s)`);
      }
    } catch (error) {
      this.logger.error(error, 'Receipt worker tick failed');
    } finally {
      this.running = false;
    }
  }
}
