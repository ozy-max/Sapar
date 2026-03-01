import { Module } from '@nestjs/common';
import { TripsController } from './controllers/trips.controller';
import { BookingsController } from './controllers/bookings.controller';
import { InternalEventsController } from './controllers/internal-events.controller';
import { BffReadController } from './controllers/bff-read.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { HmacGuard } from './guards/hmac.guard';
import { CreateTripUseCase } from '../../application/create-trip.usecase';
import { SearchTripsUseCase } from '../../application/search-trips.usecase';
import { BookSeatUseCase } from '../../application/book-seat.usecase';
import { CancelBookingUseCase } from '../../application/cancel-booking.usecase';
import { CancelTripUseCase } from '../../application/cancel-trip.usecase';
import { OnPaymentHoldPlacedHandler } from '../../application/handlers/on-payment-hold-placed.handler';
import { OnPaymentIntentFailedHandler } from '../../application/handlers/on-payment-intent-failed.handler';

@Module({
  controllers: [TripsController, BookingsController, InternalEventsController, BffReadController],
  providers: [
    JwtAuthGuard,
    HmacGuard,
    CreateTripUseCase,
    SearchTripsUseCase,
    BookSeatUseCase,
    CancelBookingUseCase,
    CancelTripUseCase,
    OnPaymentHoldPlacedHandler,
    OnPaymentIntentFailedHandler,
  ],
})
export class TripsModule {}
