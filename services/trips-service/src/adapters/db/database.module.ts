import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TripRepository } from './trip.repository';
import { BookingRepository } from './booking.repository';
import { IdempotencyRepository } from './idempotency.repository';
import { OutboxEventRepository } from './outbox-event.repository';
import { OutboxService } from '../../shared/outbox.service';

@Global()
@Module({
  providers: [
    PrismaService,
    TripRepository,
    BookingRepository,
    IdempotencyRepository,
    OutboxEventRepository,
    OutboxService,
  ],
  exports: [
    PrismaService,
    TripRepository,
    BookingRepository,
    IdempotencyRepository,
    OutboxEventRepository,
    OutboxService,
  ],
})
export class DatabaseModule {}
