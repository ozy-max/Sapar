export type RatingRole = 'DRIVER_RATES_PASSENGER' | 'PASSENGER_RATES_DRIVER';
export type RatingStatusType = 'ACTIVE' | 'DELETED';

export interface RatingEntity {
  id: string;
  tripId: string;
  bookingId: string;
  raterUserId: string;
  ratedUserId: string;
  role: RatingRole;
  score: number;
  comment: string | null;
  status: RatingStatusType;
  createdAt: Date;
}
