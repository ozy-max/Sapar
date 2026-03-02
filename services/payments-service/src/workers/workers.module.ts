import { Module } from '@nestjs/common';
import { ReceiptWorker } from './receipt.worker';
import { OutboxWorker } from './outbox.worker';
import { ReconciliationWorker } from './reconciliation.worker';
import { HoldPlacementWorker } from './hold-placement.worker';
import { ProcessReceiptsUseCase } from '../application/process-receipts.usecase';

@Module({
  providers: [
    ReceiptWorker,
    OutboxWorker,
    ReconciliationWorker,
    HoldPlacementWorker,
    ProcessReceiptsUseCase,
  ],
  exports: [
    ReceiptWorker,
    OutboxWorker,
    ReconciliationWorker,
    HoldPlacementWorker,
    ProcessReceiptsUseCase,
  ],
})
export class WorkersModule {}
