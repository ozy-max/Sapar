-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "from_city" TEXT NOT NULL,
    "to_city" TEXT NOT NULL,
    "depart_at" TIMESTAMP(3) NOT NULL,
    "seats_total" INTEGER NOT NULL,
    "seats_available" INTEGER NOT NULL,
    "price_kgs" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "BookingStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_from_city_to_city_depart_at_idx" ON "trips"("from_city", "to_city", "depart_at");

-- CreateIndex
CREATE INDEX "trips_driver_id_depart_at_idx" ON "trips"("driver_id", "depart_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_trip_id_passenger_id_key" ON "bookings"("trip_id", "passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_user_id_key" ON "idempotency_records"("key", "user_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
