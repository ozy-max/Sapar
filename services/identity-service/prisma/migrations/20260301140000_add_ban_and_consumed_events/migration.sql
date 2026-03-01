-- Add ban fields to users
ALTER TABLE "users" ADD COLUMN "banned_until" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "ban_reason" TEXT;

-- Create consumed_events table for idempotent event processing
CREATE TABLE "consumed_events" (
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "producer" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,

    CONSTRAINT "consumed_events_pkey" PRIMARY KEY ("event_id")
);
