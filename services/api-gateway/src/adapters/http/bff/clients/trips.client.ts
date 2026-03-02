import { bffFetch, BffResponse } from './bff-http.client';
import { loadEnv } from '../../../../config/env';

export interface TripsSearchParams {
  fromCity?: string;
  toCity?: string;
  fromCityId?: string;
  toCityId?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  radiusKm?: number;
  bboxMinLat?: number;
  bboxMinLon?: number;
  bboxMaxLat?: number;
  bboxMaxLon?: number;
  dateFrom?: string;
  dateTo?: string;
  minSeats?: number;
  priceMin?: number;
  priceMax?: number;
  limit?: number;
  offset?: number;
}

export interface TripSearchItem {
  tripId: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  fromCityId?: string | null;
  toCityId?: string | null;
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

function appendOptional(
  qs: URLSearchParams,
  key: string,
  value: string | number | undefined | null,
): void {
  if (value !== undefined && value !== null) qs.set(key, String(value));
}

export async function searchTrips(
  params: TripsSearchParams,
  headers: Record<string, string>,
): Promise<BffResponse<TripsSearchResponse>> {
  const qs = new URLSearchParams();
  appendOptional(qs, 'fromCity', params.fromCity);
  appendOptional(qs, 'toCity', params.toCity);
  appendOptional(qs, 'fromCityId', params.fromCityId);
  appendOptional(qs, 'toCityId', params.toCityId);
  appendOptional(qs, 'fromLat', params.fromLat);
  appendOptional(qs, 'fromLon', params.fromLon);
  appendOptional(qs, 'toLat', params.toLat);
  appendOptional(qs, 'toLon', params.toLon);
  appendOptional(qs, 'radiusKm', params.radiusKm);
  appendOptional(qs, 'bboxMinLat', params.bboxMinLat);
  appendOptional(qs, 'bboxMinLon', params.bboxMinLon);
  appendOptional(qs, 'bboxMaxLat', params.bboxMaxLat);
  appendOptional(qs, 'bboxMaxLon', params.bboxMaxLon);
  appendOptional(qs, 'dateFrom', params.dateFrom);
  appendOptional(qs, 'dateTo', params.dateTo);
  appendOptional(qs, 'minSeats', params.minSeats);
  appendOptional(qs, 'priceMin', params.priceMin);
  appendOptional(qs, 'priceMax', params.priceMax);
  appendOptional(qs, 'limit', params.limit);
  appendOptional(qs, 'offset', params.offset);

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
