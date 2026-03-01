import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TripRepository } from './trip.repository';
import { BookingRepository } from './booking.repository';
import { IdempotencyRepository } from './idempotency.repository';

@Global()
@Module({
  providers: [PrismaService, TripRepository, BookingRepository, IdempotencyRepository],
  exports: [PrismaService, TripRepository, BookingRepository, IdempotencyRepository],
})
export class DatabaseModule {}
