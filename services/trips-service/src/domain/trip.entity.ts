export interface TripEntity {
  id: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  departAt: Date;
  seatsTotal: number;
  seatsAvailable: number;
  priceKgs: number;
  status: 'DRAFT' | 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  createdAt: Date;
  updatedAt: Date;
}
