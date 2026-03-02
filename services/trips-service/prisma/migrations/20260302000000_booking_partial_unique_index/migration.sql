-- Drop the existing unique constraint (Prisma names it bookings_trip_id_passenger_id_key)
DROP INDEX IF EXISTS "bookings_trip_id_passenger_id_key";

-- Create partial unique index: only one active booking per passenger per trip
CREATE UNIQUE INDEX "bookings_active_trip_passenger_unique"
ON "bookings" ("trip_id", "passenger_id")
WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED');
