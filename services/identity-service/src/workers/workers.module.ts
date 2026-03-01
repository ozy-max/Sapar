import { Module } from '@nestjs/common';
import { AdminCommandWorker } from './admin-command.worker';

@Module({
  providers: [AdminCommandWorker],
})
export class WorkersModule {}
