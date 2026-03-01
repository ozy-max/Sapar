import { Module } from '@nestjs/common';
import { TripsController } from './controllers/trips.controller';
import { BookingsController } from './controllers/bookings.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CreateTripUseCase } from '../../application/create-trip.usecase';
import { SearchTripsUseCase } from '../../application/search-trips.usecase';
import { BookSeatUseCase } from '../../application/book-seat.usecase';
import { CancelBookingUseCase } from '../../application/cancel-booking.usecase';
import { CancelTripUseCase } from '../../application/cancel-trip.usecase';

@Module({
  controllers: [TripsController, BookingsController],
  providers: [
    JwtAuthGuard,
    CreateTripUseCase,
    SearchTripsUseCase,
    BookSeatUseCase,
    CancelBookingUseCase,
    CancelTripUseCase,
  ],
})
export class TripsModule {}
