import { Module } from '@nestjs/common';
import { ReceiptWorker } from './receipt.worker';
import { OutboxWorker } from './outbox.worker';
import { ReconciliationWorker } from './reconciliation.worker';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';

@Module({
  providers: [ReceiptWorker, OutboxWorker, ReconciliationWorker, ProcessReceiptsUseCase],
  exports: [ReceiptWorker, OutboxWorker, ReconciliationWorker, ProcessReceiptsUseCase],
})
export class WorkersModule {}
