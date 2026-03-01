-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'HOLD_PLACED', 'CAPTURED', 'CANCELLED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM ('INTENT_CREATED', 'HOLD_PLACED', 'CAPTURE_REQUESTED', 'CAPTURED', 'CANCEL_REQUESTED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED', 'FAILED', 'WEBHOOK_RECEIVED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED_FINAL');

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "amount_kgs" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KGS',
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "psp_provider" TEXT NOT NULL DEFAULT 'fake',
    "psp_intent_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "type" "PaymentEventType" NOT NULL,
    "external_event_id" TEXT,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "try_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_booking_id_key" ON "payment_intents"("booking_id");

-- CreateIndex
CREATE INDEX "payment_intents_status_idx" ON "payment_intents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotency_key_payer_id_key" ON "payment_intents"("idempotency_key", "payer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_external_event_id_key" ON "payment_events"("external_event_id");

-- CreateIndex
CREATE INDEX "payment_events_payment_intent_id_idx" ON "payment_events"("payment_intent_id");

-- CreateIndex
CREATE INDEX "receipts_status_next_retry_at_idx" ON "receipts"("status", "next_retry_at");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
