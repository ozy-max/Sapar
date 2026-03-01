export interface BookingEntity {
  id: string;
  tripId: string;
  passengerId: string;
  seats: number;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
}
