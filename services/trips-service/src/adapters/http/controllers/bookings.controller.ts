import {
  Controller,
  Post,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { CancelBookingUseCase } from '../../../application/cancel-booking.usecase';
import { ErrorResponseDto } from '../dto/error.dto';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly cancelBooking: CancelBookingUseCase) {}

  @Post(':bookingId/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a booking (passenger or trip driver)' })
  @ApiParam({ name: 'bookingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { example: { bookingId: 'uuid', status: 'CANCELLED' } } })
  @ApiResponse({ status: 401, type: ErrorResponseDto })
  @ApiResponse({ status: 403, type: ErrorResponseDto })
  @ApiResponse({ status: 404, type: ErrorResponseDto })
  @ApiResponse({ status: 409, type: ErrorResponseDto })
  async cancel(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() userId: string,
    @Headers('x-request-id') traceId?: string,
  ): Promise<{ bookingId: string; status: string }> {
    return this.cancelBooking.execute({ bookingId, userId, traceId: traceId ?? '' });
  }
}
