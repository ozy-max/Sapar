import { searchTrips, TripsSearchParams } from '../clients/trips.client';
import { mapBffError } from '../mappers/bff-error.mapper';
import { TripsSearchResponseDto, TripCardDto } from '../dto/bff.dto';

interface TripsSearchHandlerInput {
  params: TripsSearchParams;
  headers: Record<string, string>;
  traceId: string;
}

export async function handleTripsSearch(
  input: TripsSearchHandlerInput,
): Promise<TripsSearchResponseDto> {
  try {
    const resp = await searchTrips(input.params, input.headers);

    const items: TripCardDto[] = resp.data.items.map((t) => ({
      tripId: t.tripId,
      fromCity: t.fromCity,
      toCity: t.toCity,
      departAt: t.departAt,
      priceKgs: t.priceKgs,
      seatsAvailable: t.seatsAvailable,
      driverId: t.driverId,
      status: t.status,
    }));

    return {
      items,
      paging: {
        limit: input.params.limit ?? 50,
        offset: input.params.offset ?? 0,
        total: resp.data.count,
      },
      meta: { traceId: input.traceId },
    };
  } catch (error: unknown) {
    throw mapBffError(error, input.traceId);
  }
}
