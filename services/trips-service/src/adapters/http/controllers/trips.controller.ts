import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { CreateTripUseCase } from '../../../application/create-trip.usecase';
import { SearchTripsUseCase } from '../../../application/search-trips.usecase';
import { BookSeatUseCase } from '../../../application/book-seat.usecase';
import { CancelTripUseCase } from '../../../application/cancel-trip.usecase';
import { CompleteTripUseCase } from '../../../application/complete-trip.usecase';
import {
  createTripSchema,
  CreateTripInput,
  CreateTripBodyDto,
  CreateTripResponseDto,
} from '../dto/create-trip.dto';
import {
  searchTripsSchema,
  SearchTripsInput,
  SearchTripsQueryDto,
  SearchTripsResponseDto,
} from '../dto/search-trips.dto';
import {
  bookSeatSchema,
  BookSeatInput,
  BookSeatBodyDto,
  BookSeatResponseDto,
} from '../dto/book-seat.dto';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('trips')
@Controller()
export class TripsController {
  constructor(
    private readonly createTrip: CreateTripUseCase,
    private readonly searchTrips: SearchTripsUseCase,
    private readonly bookSeat: BookSeatUseCase,
    private readonly cancelTrip: CancelTripUseCase,
    private readonly completeTrip: CompleteTripUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new trip (driver)' })
  @ApiBody({ type: CreateTripBodyDto })
  @ApiResponse({ status: 201, type: CreateTripResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createTripSchema)) input: CreateTripInput,
  ): Promise<CreateTripResponseDto> {
    return this.createTrip.execute({ ...input, driverId: userId });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search active trips (passenger)' })
  @ApiQuery({ type: SearchTripsQueryDto })
  @ApiResponse({ status: 200, type: SearchTripsResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  async search(
    @Query(new ZodValidationPipe(searchTripsSchema)) query: SearchTripsInput,
  ): Promise<SearchTripsResponseDto> {
    return this.searchTrips.execute(query);
  }

  @Post(':tripId/book')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Book a seat on a trip (passenger)' })
  @ApiParam({ name: 'tripId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiBody({ type: BookSeatBodyDto })
  @ApiResponse({ status: 201, type: BookSeatResponseDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto })
  async book(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(bookSeatSchema)) input: BookSeatInput,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<BookSeatResponseDto> {
    return this.bookSeat.execute({
      tripId,
      passengerId: userId,
      seats: input.seats,
      idempotencyKey,
      traceId: traceId ?? '',
    });
  }

  @Post(':tripId/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a trip (driver only)' })
  @ApiParam({ name: 'tripId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { example: { tripId: 'uuid', status: 'CANCELLED' } } })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto })
  async cancel(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @CurrentUser() userId: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<{ tripId: string; status: string }> {
    return this.cancelTrip.execute({ tripId, userId, traceId: traceId ?? '' });
  }

  @Post(':tripId/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete a trip (driver only)' })
  @ApiParam({ name: 'tripId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { example: { tripId: 'uuid', status: 'COMPLETED', completedAt: '2026-01-01T00:00:00.000Z' } } })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto })
  async complete(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @CurrentUser() userId: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<{ tripId: string; status: string; completedAt: string }> {
    return this.completeTrip.execute({ tripId, userId, traceId: traceId ?? '' });
  }
}
