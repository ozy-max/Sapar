import { bffFetch, BffResponse } from './bff-http.client';
import { loadEnv } from '../../../../config/env';

export interface TripsSearchParams {
  fromCity: string;
  toCity: string;
  dateFrom?: string;
  dateTo?: string;
  minSeats?: number;
  limit?: number;
  offset?: number;
}

export interface TripSearchItem {
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

export interface TripsSearchResponse {
  items: TripSearchItem[];
  count: number;
}

export interface TripDetailDownstream {
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

export interface BookingDetailDownstream {
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

export interface MyBookingItem {
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

export interface MyBookingsDownstream {
  items: MyBookingItem[];
  total: number;
}

function tripsBaseUrl(): string {
  return loadEnv().TRIPS_BASE_URL;
}

function timeoutMs(): number {
  return loadEnv().BFF_TIMEOUT_MS;
}

export async function searchTrips(
  params: TripsSearchParams,
  headers: Record<string, string>,
): Promise<BffResponse<TripsSearchResponse>> {
  const qs = new URLSearchParams();
  qs.set('fromCity', params.fromCity);
  qs.set('toCity', params.toCity);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.minSeats !== undefined) qs.set('minSeats', String(params.minSeats));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  return bffFetch<TripsSearchResponse>('trips', {
    baseUrl: tripsBaseUrl(),
    path: `/search?${qs.toString()}`,
    timeoutMs: timeoutMs(),
    headers,
  });
}

export async function getTripDetail(
  tripId: string,
  headers: Record<string, string>,
): Promise<BffResponse<TripDetailDownstream>> {
  return bffFetch<TripDetailDownstream>('trips', {
    baseUrl: tripsBaseUrl(),
    path: `/bff/trips/${encodeURIComponent(tripId)}`,
    timeoutMs: timeoutMs(),
    headers,
  });
}

export async function getBookingDetail(
  bookingId: string,
  headers: Record<string, string>,
): Promise<BffResponse<BookingDetailDownstream>> {
  return bffFetch<BookingDetailDownstream>('trips', {
    baseUrl: tripsBaseUrl(),
    path: `/bff/bookings/${encodeURIComponent(bookingId)}`,
    timeoutMs: timeoutMs(),
    headers,
  });
}

export async function getMyBookings(
  params: { status?: string; limit?: number; offset?: number },
  headers: Record<string, string>,
): Promise<BffResponse<MyBookingsDownstream>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  const qsStr = qs.toString();
  const path = `/bff/me/bookings${qsStr ? `?${qsStr}` : ''}`;

  return bffFetch<MyBookingsDownstream>('trips', {
    baseUrl: tripsBaseUrl(),
    path,
    timeoutMs: timeoutMs(),
    headers,
  });
}
