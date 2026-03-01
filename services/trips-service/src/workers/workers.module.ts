import { Module } from '@nestjs/common';
import { OutboxWorker } from './outbox.worker';
import { BookingExpirationWorker } from './booking-expiration.worker';
import { AdminCommandWorker } from './admin-command.worker';

@Module({
  providers: [OutboxWorker, BookingExpirationWorker, AdminCommandWorker],
  exports: [OutboxWorker, BookingExpirationWorker, AdminCommandWorker],
})
export class WorkersModule {}
