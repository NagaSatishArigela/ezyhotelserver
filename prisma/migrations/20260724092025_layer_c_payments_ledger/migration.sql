-- CreateEnum
CREATE TYPE "finance"."PaymentGatewayStatus" AS ENUM ('created', 'captured', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "finance"."LedgerAccount" AS ENUM ('guest_clearing', 'owner_payable', 'platform_commission', 'gst_payable', 'tds_payable', 'bank_settlement');

-- CreateEnum
CREATE TYPE "finance"."LedgerDirection" AS ENUM ('debit', 'credit');

-- CreateTable
CREATE TABLE "finance"."payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "gateway_order_id" TEXT NOT NULL,
    "gateway_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "status" "finance"."PaymentGatewayStatus" NOT NULL DEFAULT 'created',
    "signature" TEXT,
    "failure_reason" TEXT,
    "captured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."ledger_entries" (
    "id" UUID NOT NULL,
    "txn_ref" TEXT NOT NULL,
    "account" "finance"."LedgerAccount" NOT NULL,
    "direction" "finance"."LedgerDirection" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_order_id_key" ON "finance"."payments"("gateway_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "finance"."payments"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "finance"."payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "finance"."payments"("status");

-- CreateIndex
CREATE INDEX "ledger_entries_txn_ref_idx" ON "finance"."ledger_entries"("txn_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_account_idx" ON "finance"."ledger_entries"("account");

-- CreateIndex
CREATE INDEX "ledger_entries_ref_type_ref_id_idx" ON "finance"."ledger_entries"("ref_type", "ref_id");
