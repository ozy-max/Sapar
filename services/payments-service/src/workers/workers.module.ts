import { Module } from '@nestjs/common';
import { ReceiptWorker } from './receipt.worker';
import { OutboxWorker } from './outbox.worker';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';

@Module({
  providers: [ReceiptWorker, OutboxWorker, ProcessReceiptsUseCase],
  exports: [ReceiptWorker, OutboxWorker, ProcessReceiptsUseCase],
})
export class WorkersModule {}
