import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { TripRepository } from '../../db/trip.repository';
import { BookingRepository } from '../../db/booking.repository';
import { ErrorResponseDto } from '../dto/error.dto';
import { TripNotFoundError, BookingNotFoundError, ForbiddenError } from '../../../shared/errors';

interface TripDetailResponse {
  tripId: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  departAt: string;
  seatsTotal: number;
  seatsAvailable: number;
  priceKgs: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface BookingDetailResponse {
  bookingId: string;
  tripId: string;
  passengerId: string;
  seats: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  trip: {
    tripId: string;
    driverId: string;
    fromCity: string;
    toCity: string;
    departAt: string;
    seatsTotal: number;
    seatsAvailable: number;
    priceKgs: number;
    status: string;
  };
}

interface MyBookingItem {
  bookingId: string;
  tripId: string;
  seats: number;
  status: string;
  createdAt: string;
  trip: {
    fromCity: string;
    toCity: string;
    departAt: string;
    priceKgs: number;
  };
}

interface MyBookingsResponse {
  items: MyBookingItem[];
  total: number;
}

@ApiTags('BFF Read')
@Controller('bff')
export class BffReadController {
  constructor(
    private readonly tripRepo: TripRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  @Get('trips/:tripId')
  @ApiOperation({ summary: 'Get trip by ID (BFF read)' })
  @ApiParam({ name: 'tripId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Trip details' })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async getTripById(
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
  ): Promise<TripDetailResponse> {
    const trip = await this.tripRepo.findById(tripId);
    if (!trip) throw new TripNotFoundError();

    return {
      tripId: trip.id,
      driverId: trip.driverId,
      fromCity: trip.fromCity,
      toCity: trip.toCity,
      departAt: trip.departAt.toISOString(),
      seatsTotal: trip.seatsTotal,
      seatsAvailable: trip.seatsAvailable,
      priceKgs: trip.priceKgs,
      status: trip.status,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }

  @Get('bookings/:bookingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get booking by ID with trip info (BFF read)' })
  @ApiParam({ name: 'bookingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking with trip details' })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  async getBookingById(
    @CurrentUser() userId: string,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ): Promise<BookingDetailResponse> {
    const booking = await this.bookingRepo.findByIdWithTrip(bookingId);
    if (!booking) throw new BookingNotFoundError();

    const isPassenger = booking.passengerId === userId;
    const isDriver = booking.trip.driverId === userId;
    if (!isPassenger && !isDriver) {
      throw new ForbiddenError();
    }

    return {
      bookingId: booking.id,
      tripId: booking.tripId,
      passengerId: booking.passengerId,
      seats: booking.seats,
      status: booking.status,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
      trip: {
        tripId: booking.trip.id,
        driverId: booking.trip.driverId,
        fromCity: booking.trip.fromCity,
        toCity: booking.trip.toCity,
        departAt: booking.trip.departAt.toISOString(),
        seatsTotal: booking.trip.seatsTotal,
        seatsAvailable: booking.trip.seatsAvailable,
        priceKgs: booking.trip.priceKgs,
        status: booking.trip.status,
      },
    };
  }

  @Get('me/bookings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my bookings (BFF read)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 200, description: 'Paginated list of bookings' })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  async getMyBookings(
    @CurrentUser() userId: string,
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<MyBookingsResponse> {
    const limit = Math.min(Math.max(parseInt(limitStr ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(offsetStr ?? '0', 10) || 0, 0);

    const result = await this.bookingRepo.findByPassengerId(userId, status, limit, offset);

    return {
      items: result.items.map((b) => ({
        bookingId: b.id,
        tripId: b.tripId,
        seats: b.seats,
        status: b.status,
        createdAt: b.createdAt.toISOString(),
        trip: {
          fromCity: b.trip.fromCity,
          toCity: b.trip.toCity,
          departAt: b.trip.departAt.toISOString(),
          priceKgs: b.trip.priceKgs,
        },
      })),
      total: result.total,
    };
  }
}
