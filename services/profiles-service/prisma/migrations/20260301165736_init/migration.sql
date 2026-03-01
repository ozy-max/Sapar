-- CreateEnum
CREATE TYPE "RatingRole" AS ENUM ('DRIVER_RATES_PASSENGER', 'PASSENGER_RATES_DRIVER');

-- CreateEnum
CREATE TYPE "RatingStatus" AS ENUM ('ACTIVE', 'DELETED');

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "bio" TEXT,
    "city" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "rater_user_id" UUID NOT NULL,
    "rated_user_id" UUID NOT NULL,
    "role" "RatingRole" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "RatingStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_aggregates" (
    "user_id" UUID NOT NULL,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_aggregates_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "rating_eligibilities" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumed_events" (
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "producer" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,

    CONSTRAINT "consumed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "user_profiles_city_idx" ON "user_profiles"("city");

-- CreateIndex
CREATE INDEX "ratings_rated_user_id_status_created_at_idx" ON "ratings"("rated_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ratings_trip_id_idx" ON "ratings"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_trip_id_rater_user_id_role_key" ON "ratings"("trip_id", "rater_user_id", "role");

-- CreateIndex
CREATE INDEX "rating_eligibilities_booking_id_idx" ON "rating_eligibilities"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "rating_eligibilities_trip_id_passenger_id_key" ON "rating_eligibilities"("trip_id", "passenger_id");
