import { Module } from '@nestjs/common';
import { OutboxWorker } from './outbox.worker';
import { BookingExpirationWorker } from './booking-expiration.worker';

@Module({
  providers: [OutboxWorker, BookingExpirationWorker],
  exports: [OutboxWorker, BookingExpirationWorker],
})
export class WorkersModule {}
