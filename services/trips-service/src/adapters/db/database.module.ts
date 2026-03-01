import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TripRepository } from './trip.repository';
import { CityRepository } from './city.repository';
import { BookingRepository } from './booking.repository';
import { IdempotencyRepository } from './idempotency.repository';
import { OutboxEventRepository } from './outbox-event.repository';
import { ConsumedEventRepository } from './consumed-event.repository';
import { OutboxService } from '../../shared/outbox.service';

@Global()
@Module({
  providers: [
    PrismaService,
    TripRepository,
    CityRepository,
    BookingRepository,
    IdempotencyRepository,
    OutboxEventRepository,
    ConsumedEventRepository,
    OutboxService,
  ],
  exports: [
    PrismaService,
    TripRepository,
    CityRepository,
    BookingRepository,
    IdempotencyRepository,
    OutboxEventRepository,
    ConsumedEventRepository,
    OutboxService,
  ],
})
export class DatabaseModule {}
