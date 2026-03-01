import { Injectable } from '@nestjs/common';
import { TripRepository } from '../adapters/db/trip.repository';

interface SearchTripsInput {
  fromCity: string;
  toCity: string;
  dateFrom?: string;
  dateTo?: string;
  minSeats: number;
  limit: number;
  offset: number;
}

interface TripItem {
  tripId: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  departAt: string;
  seatsTotal: number;
  seatsAvailable: number;
  priceKgs: number;
  status: string;
}

interface SearchTripsOutput {
  items: TripItem[];
  count: number;
}

@Injectable()
export class SearchTripsUseCase {
  constructor(private readonly tripRepo: TripRepository) {}

  async execute(input: SearchTripsInput): Promise<SearchTripsOutput> {
    const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined;
    const dateTo = input.dateTo ? new Date(input.dateTo) : undefined;

    const [trips, totalCount] = await Promise.all([
      this.tripRepo.search({
        fromCity: input.fromCity,
        toCity: input.toCity,
        dateFrom,
        dateTo,
        minSeats: input.minSeats,
        limit: input.limit,
        offset: input.offset,
      }),
      this.tripRepo.searchCount({
        fromCity: input.fromCity,
        toCity: input.toCity,
        dateFrom,
        dateTo,
        minSeats: input.minSeats,
      }),
    ]);

    const items: TripItem[] = trips.map((t) => ({
      tripId: t.id,
      driverId: t.driverId,
      fromCity: t.fromCity,
      toCity: t.toCity,
      departAt: t.departAt.toISOString(),
      seatsTotal: t.seatsTotal,
      seatsAvailable: t.seatsAvailable,
      priceKgs: t.priceKgs,
      status: t.status,
    }));

    return { items, count: totalCount };
  }
}
