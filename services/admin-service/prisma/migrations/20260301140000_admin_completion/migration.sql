-- AlterEnum: AdminCommandStatus PENDING -> keep, PROCESSED -> drop, FAILED -> drop, add APPLIED, FAILED_RETRY, FAILED_FINAL
-- We recreate the enum since Prisma doesn't support rename values.

-- Step 1: Add new columns to admin_commands before enum change
ALTER TABLE "admin_commands" ADD COLUMN "target_service" TEXT NOT NULL DEFAULT 'identity';
ALTER TABLE "admin_commands" ADD COLUMN "try_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_commands" ADD COLUMN "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "admin_commands" ADD COLUMN "last_error" TEXT;
ALTER TABLE "admin_commands" ADD COLUMN "trace_id" TEXT NOT NULL DEFAULT '';

-- Step 2: Replace AdminCommandStatus enum
CREATE TYPE "AdminCommandStatus_new" AS ENUM ('PENDING', 'APPLIED', 'FAILED_RETRY', 'FAILED_FINAL');
ALTER TABLE "admin_commands" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "admin_commands" ALTER COLUMN "status" TYPE "AdminCommandStatus_new"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'PENDING'::"AdminCommandStatus_new"
      WHEN 'PROCESSED' THEN 'APPLIED'::"AdminCommandStatus_new"
      WHEN 'FAILED' THEN 'FAILED_FINAL'::"AdminCommandStatus_new"
    END
  );
DROP TYPE "AdminCommandStatus";
ALTER TYPE "AdminCommandStatus_new" RENAME TO "AdminCommandStatus";
ALTER TABLE "admin_commands" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Step 3: Add index for command polling (SKIP LOCKED friendly)
CREATE INDEX "admin_commands_target_service_status_next_retry_at_idx"
  ON "admin_commands"("target_service", "status", "next_retry_at");

-- Step 4: Add version column to configs
ALTER TABLE "configs" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Step 5: Create outbox_events table
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED_RETRY', 'FAILED_FINAL');

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "try_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_events_status_next_retry_at_idx"
  ON "outbox_events"("status", "next_retry_at");
