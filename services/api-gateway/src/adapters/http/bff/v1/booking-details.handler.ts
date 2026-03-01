import { getBookingDetail } from '../clients/trips.client';
import { getPaymentSummary } from '../clients/payments.client';
import { mapBffError } from '../mappers/bff-error.mapper';
import { BookingDetailsResponseDto } from '../dto/bff.dto';

interface BookingDetailsInput {
  bookingId: string;
  headers: Record<string, string>;
  traceId: string;
}

export async function handleBookingDetails(
  input: BookingDetailsInput,
): Promise<BookingDetailsResponseDto> {
  try {
    const [bookingResp, paymentResp] = await Promise.all([
      getBookingDetail(input.bookingId, input.headers),
      getPaymentSummary(input.bookingId, input.headers).catch((): null => null),
    ]);

    const b = bookingResp.data;
    const p = paymentResp?.data ?? null;

    return {
      bookingId: b.bookingId,
      tripId: b.tripId,
      seats: b.seats,
      status: b.status,
      createdAt: b.createdAt,
      trip: {
        tripId: b.trip.tripId,
        fromCity: b.trip.fromCity,
        toCity: b.trip.toCity,
        departAt: b.trip.departAt,
        priceKgs: b.trip.priceKgs,
      },
      payment: {
        paymentIntentId: p?.paymentIntentId ?? null,
        paymentStatus: p?.paymentStatus ?? null,
        amountKgs: p?.amountKgs ?? null,
        receiptStatus: p?.receiptStatus ?? null,
      },
      meta: { traceId: input.traceId },
    };
  } catch (error: unknown) {
    throw mapBffError(error, input.traceId);
  }
}
