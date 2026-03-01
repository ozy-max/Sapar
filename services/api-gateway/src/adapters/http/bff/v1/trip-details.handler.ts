import { getTripDetail } from '../clients/trips.client';
import { getDriverRatingAggregate } from '../clients/profiles.client';
import { mapBffError } from '../mappers/bff-error.mapper';
import { TripDetailsResponseDto } from '../dto/bff.dto';

interface TripDetailsInput {
  tripId: string;
  headers: Record<string, string>;
  traceId: string;
}

export async function handleTripDetails(input: TripDetailsInput): Promise<TripDetailsResponseDto> {
  try {
    const resp = await getTripDetail(input.tripId, input.headers);
    const t = resp.data;

    let driverRating: { ratingAvg: number; ratingCount: number; displayName: string } | undefined;
    if (t.driverId) {
      const agg = await getDriverRatingAggregate(t.driverId, input.headers);
      if (agg) {
        driverRating = agg;
      }
    }

    return {
      tripId: t.tripId,
      fromCity: t.fromCity,
      toCity: t.toCity,
      departAt: t.departAt,
      priceKgs: t.priceKgs,
      seatsTotal: t.seatsTotal,
      seatsAvailable: t.seatsAvailable,
      status: t.status,
      driverId: t.driverId,
      driverRating,
      meta: { traceId: input.traceId },
    };
  } catch (error: unknown) {
    throw mapBffError(error, input.traceId);
  }
}
