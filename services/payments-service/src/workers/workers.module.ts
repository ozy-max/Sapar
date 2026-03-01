import { Module } from '@nestjs/common';
import { ReceiptWorker } from './receipt.worker';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';

@Module({
  providers: [ReceiptWorker, ProcessReceiptsUseCase],
  exports: [ReceiptWorker, ProcessReceiptsUseCase],
})
export class WorkersModule {}
