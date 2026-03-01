export interface RatingEligibilityEntity {
  id: string;
  tripId: string;
  bookingId: string;
  driverId: string;
  passengerId: string;
  completedAt: Date;
  createdAt: Date;
}
