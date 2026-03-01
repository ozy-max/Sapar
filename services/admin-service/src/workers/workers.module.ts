import { Module } from '@nestjs/common';
import { OutboxWorker } from './outbox.worker';

@Module({
  providers: [OutboxWorker],
})
export class WorkersModule {}
