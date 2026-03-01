export interface CityEntity {
  id: string;
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
  createdAt: Date;
}

export interface TripEntity {
  id: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  fromCityId: string | null;
  toCityId: string | null;
  fromLat: number | null;
  fromLon: number | null;
  toLat: number | null;
  toLon: number | null;
  departAt: Date;
  seatsTotal: number;
  seatsAvailable: number;
  priceKgs: number;
  status: 'DRAFT' | 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  createdAt: Date;
  updatedAt: Date;
}
