-- CreateEnum
CREATE TYPE "ConfigType" AS ENUM ('INT', 'FLOAT', 'BOOL', 'STRING', 'JSON');
CREATE TYPE "DisputeType" AS ENUM ('NO_SHOW', 'OTHER');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');
CREATE TYPE "DisputeResolution" AS ENUM ('REFUND', 'NO_REFUND', 'PARTIAL', 'BAN_USER');
CREATE TYPE "AdminCommandType" AS ENUM ('BAN_USER', 'UNBAN_USER', 'CANCEL_TRIP');
CREATE TYPE "AdminCommandStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable configs
CREATE TABLE "configs" (
    "key" TEXT NOT NULL,
    "type" "ConfigType" NOT NULL,
    "value_json" JSONB NOT NULL,
    "description" TEXT,
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable disputes
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "type" "DisputeType" NOT NULL,
    "booking_id" TEXT NOT NULL,
    "depart_at" TIMESTAMP(3) NOT NULL,
    "evidence_urls" TEXT[],
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "DisputeResolution",
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "disputes_status_idx" ON "disputes"("status");
CREATE INDEX "disputes_booking_id_idx" ON "disputes"("booking_id");

-- CreateTable audit_logs
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_roles" TEXT[],
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload_json" JSONB,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateTable admin_commands
CREATE TABLE "admin_commands" (
    "id" UUID NOT NULL,
    "type" "AdminCommandType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AdminCommandStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_commands_pkey" PRIMARY KEY ("id")
);
