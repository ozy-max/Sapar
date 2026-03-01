import { getMyBookings } from '../clients/trips.client';
import { batchPaymentSummary } from '../clients/payments.client';
import { mapBffError } from '../mappers/bff-error.mapper';
import { MyBookingsResponseDto, MyBookingItemDto } from '../dto/bff.dto';
import { PaymentSummary } from '../clients/payments.client';

interface MyBookingsInput {
  status?: string;
  limit: number;
  offset: number;
  headers: Record<string, string>;
  traceId: string;
}

export async function handleMyBookings(input: MyBookingsInput): Promise<MyBookingsResponseDto> {
  try {
    const bookingsResp = await getMyBookings(
      { status: input.status, limit: input.limit, offset: input.offset },
      input.headers,
    );

    const bookings = bookingsResp.data;
    const bookingIds = bookings.items.map((b) => b.bookingId).slice(0, 50);

    let paymentMap = new Map<string, PaymentSummary>();
    if (bookingIds.length > 0) {
      try {
        const paymentsResp = await batchPaymentSummary(bookingIds, input.headers);
        paymentMap = new Map(paymentsResp.data.items.map((p) => [p.bookingId, p]));
      } catch {
        // Payment data is best-effort for listing; continue without it
      }
    }

    const items: MyBookingItemDto[] = bookings.items.map((b) => {
      const p = paymentMap.get(b.bookingId);
      return {
        bookingId: b.bookingId,
        tripId: b.tripId,
        seats: b.seats,
        status: b.status,
        createdAt: b.createdAt,
        trip: {
          tripId: b.tripId,
          fromCity: b.trip.fromCity,
          toCity: b.trip.toCity,
          departAt: b.trip.departAt,
          priceKgs: b.trip.priceKgs,
        },
        payment: p
          ? {
              paymentIntentId: p.paymentIntentId,
              paymentStatus: p.paymentStatus,
              amountKgs: p.amountKgs,
              receiptStatus: p.receiptStatus,
            }
          : undefined,
      };
    });

    return {
      items,
      paging: {
        limit: input.limit,
        offset: input.offset,
        total: bookings.total,
      },
      meta: { traceId: input.traceId },
    };
  } catch (error: unknown) {
    throw mapBffError(error, input.traceId);
  }
}
