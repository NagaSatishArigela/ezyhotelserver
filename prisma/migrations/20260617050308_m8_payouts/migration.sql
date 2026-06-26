-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "payouts";

-- CreateEnum
CREATE TYPE "payouts"."PayoutBatchStatus" AS ENUM ('pending', 'processing', 'released', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "payouts"."PayoutItemStatus" AS ENUM ('pending', 'on_hold', 'released', 'failed');

-- AlterEnum
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'payout_released';

-- CreateTable
CREATE TABLE "payouts"."payout_batches" (
    "id" UUID NOT NULL,
    "batch_ref" TEXT NOT NULL,
    "cycle_start_at" TIMESTAMP(3) NOT NULL,
    "cycle_end_at" TIMESTAMP(3) NOT NULL,
    "status" "payouts"."PayoutBatchStatus" NOT NULL DEFAULT 'pending',
    "total_gross_paise" INTEGER NOT NULL DEFAULT 0,
    "total_tds_paise" INTEGER NOT NULL DEFAULT 0,
    "total_net_paise" INTEGER NOT NULL DEFAULT 0,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts"."payout_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "payouts"."PayoutItemStatus" NOT NULL DEFAULT 'pending',
    "booking_count" INTEGER NOT NULL DEFAULT 0,
    "gross_amount_paise" INTEGER NOT NULL DEFAULT 0,
    "tds_paise" INTEGER NOT NULL DEFAULT 0,
    "net_amount_paise" INTEGER NOT NULL DEFAULT 0,
    "hold_reason" TEXT,
    "bank_ref" TEXT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts"."payout_booking_links" (
    "id" UUID NOT NULL,
    "payout_item_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "owner_gross_paise" INTEGER NOT NULL,
    "tds_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_booking_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_batches_batch_ref_key" ON "payouts"."payout_batches"("batch_ref");

-- CreateIndex
CREATE INDEX "payout_batches_status_idx" ON "payouts"."payout_batches"("status");

-- CreateIndex
CREATE INDEX "payout_batches_cycle_start_at_idx" ON "payouts"."payout_batches"("cycle_start_at");

-- CreateIndex
CREATE INDEX "payout_items_owner_id_idx" ON "payouts"."payout_items"("owner_id");

-- CreateIndex
CREATE INDEX "payout_items_property_id_idx" ON "payouts"."payout_items"("property_id");

-- CreateIndex
CREATE INDEX "payout_items_status_idx" ON "payouts"."payout_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_items_batch_id_property_id_key" ON "payouts"."payout_items"("batch_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_booking_links_booking_id_key" ON "payouts"."payout_booking_links"("booking_id");

-- CreateIndex
CREATE INDEX "payout_booking_links_payout_item_id_idx" ON "payouts"."payout_booking_links"("payout_item_id");

-- AddForeignKey
ALTER TABLE "payouts"."payout_items" ADD CONSTRAINT "payout_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payouts"."payout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts"."payout_booking_links" ADD CONSTRAINT "payout_booking_links_payout_item_id_fkey" FOREIGN KEY ("payout_item_id") REFERENCES "payouts"."payout_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
