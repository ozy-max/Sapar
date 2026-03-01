import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/* ── Shared envelope types ── */

export class PagingDto {
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 0 }) offset!: number;
  @ApiPropertyOptional({ example: 42 }) total?: number;
}

export class MetaDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  traceId!: string;
}

export class BffErrorDto {
  @ApiProperty({ example: 'DOWNSTREAM_TIMEOUT' }) code!: string;
  @ApiProperty({ example: 'Downstream service timed out' }) message!: string;
  @ApiPropertyOptional() details?: Record<string, unknown>;
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' }) traceId!: string;
}

/* ── Trips Search ── */

export class TripCardDto {
  @ApiProperty() tripId!: string;
  @ApiProperty() fromCity!: string;
  @ApiProperty() toCity!: string;
  @ApiProperty() departAt!: string;
  @ApiProperty() priceKgs!: number;
  @ApiProperty() seatsAvailable!: number;
  @ApiPropertyOptional() driverId?: string;
  @ApiProperty() status!: string;
}

export class TripsSearchResponseDto {
  @ApiProperty({ type: [TripCardDto] }) items!: TripCardDto[];
  @ApiProperty({ type: PagingDto }) paging!: PagingDto;
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

/* ── Trip Details ── */

export class TripDetailsResponseDto {
  @ApiProperty() tripId!: string;
  @ApiProperty() fromCity!: string;
  @ApiProperty() toCity!: string;
  @ApiProperty() departAt!: string;
  @ApiProperty() priceKgs!: number;
  @ApiProperty() seatsTotal!: number;
  @ApiProperty() seatsAvailable!: number;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() driverId?: string;
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

/* ── Booking Details ── */

export class BookingPaymentDto {
  @ApiPropertyOptional() paymentIntentId?: string | null;
  @ApiPropertyOptional() paymentStatus?: string | null;
  @ApiPropertyOptional() amountKgs?: number | null;
  @ApiPropertyOptional() receiptStatus?: string | null;
}

export class BookingTripSummaryDto {
  @ApiProperty() tripId!: string;
  @ApiProperty() fromCity!: string;
  @ApiProperty() toCity!: string;
  @ApiProperty() departAt!: string;
  @ApiProperty() priceKgs!: number;
}

export class BookingDetailsResponseDto {
  @ApiProperty() bookingId!: string;
  @ApiProperty() tripId!: string;
  @ApiProperty() seats!: number;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: BookingTripSummaryDto }) trip!: BookingTripSummaryDto;
  @ApiProperty({ type: BookingPaymentDto }) payment!: BookingPaymentDto;
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

/* ── My Bookings ── */

export class MyBookingItemDto {
  @ApiProperty() bookingId!: string;
  @ApiProperty() tripId!: string;
  @ApiProperty() seats!: number;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: BookingTripSummaryDto }) trip!: BookingTripSummaryDto;
  @ApiPropertyOptional({ type: BookingPaymentDto }) payment?: BookingPaymentDto;
}

export class MyBookingsResponseDto {
  @ApiProperty({ type: [MyBookingItemDto] }) items!: MyBookingItemDto[];
  @ApiProperty({ type: PagingDto }) paging!: PagingDto;
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}
