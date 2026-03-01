import { Module } from '@nestjs/common';
import { TripsSearchController } from './v1/trips-search.controller';
import { TripDetailsController } from './v1/trip-details.controller';
import { BookingDetailsController } from './v1/booking-details.controller';
import { MyBookingsController } from './v1/my-bookings.controller';

@Module({
  controllers: [
    TripsSearchController,
    TripDetailsController,
    BookingDetailsController,
    MyBookingsController,
  ],
})
export class BffModule {}
