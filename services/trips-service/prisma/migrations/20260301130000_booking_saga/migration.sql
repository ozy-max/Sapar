-- Booking Saga: replace BookingStatus enum, add consumed_events table

-- 1. Create new BookingStatus enum
CREATE TYPE "BookingStatus_new" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- 2. Migrate bookings column to new enum
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "BookingStatus_new" USING (
  CASE
    WHEN "status"::text = 'ACTIVE' THEN 'CONFIRMED'::"BookingStatus_new"
    WHEN "status"::text = 'CANCELLED' THEN 'CANCELLED'::"BookingStatus_new"
    ELSE 'CANCELLED'::"BookingStatus_new"
  END
);
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT'::"BookingStatus_new";

-- 3. Drop old type and rename new
DROP TYPE "BookingStatus";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";

-- 4. Add consumed_events table for idempotent event consumption
CREATE TABLE "consumed_events" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "producer" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,

    CONSTRAINT "consumed_events_pkey" PRIMARY KEY ("event_id")
);

-- 5. Index on bookings status + created_at for expiration worker
CREATE INDEX "bookings_status_created_at_idx" ON "bookings"("status", "created_at");
