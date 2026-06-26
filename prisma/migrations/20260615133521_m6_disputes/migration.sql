-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "wallet";

-- CreateEnum
CREATE TYPE "bookings"."DisputeCategory" AS ENUM ('room_quality', 'cleanliness', 'amenities', 'staff', 'safety', 'charges', 'other');

-- CreateEnum
CREATE TYPE "bookings"."DisputeRequestedResolution" AS ENUM ('full_refund', 'partial_refund', 'credit', 'apology');

-- CreateEnum
CREATE TYPE "bookings"."DisputeStatus" AS ENUM ('filed', 'under_review', 'awaiting_hotel_response', 'resolved_guest', 'resolved_hotel', 'resolved_partial', 'resolved_wallet_credit', 'escalated', 'closed_no_response');

-- CreateEnum
CREATE TYPE "bookings"."DisputeResolutionType" AS ENUM ('full_refund', 'partial_refund', 'wallet_credit', 'no_action', 'escalated');

-- CreateEnum
CREATE TYPE "wallet"."WalletCreditSourceType" AS ENUM ('dispute');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notifications"."NotificationType" ADD VALUE 'dispute_response_requested';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'dispute_resolved';

-- CreateTable
CREATE TABLE "bookings"."disputes" (
    "id" UUID NOT NULL,
    "dispute_ref" TEXT NOT NULL,
    "booking_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "category" "bookings"."DisputeCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "guest_evidence" JSONB,
    "requested_resolution" "bookings"."DisputeRequestedResolution" NOT NULL,
    "hotel_response" TEXT,
    "hotel_evidence" JSONB,
    "hotel_response_deadline" TIMESTAMP(3),
    "status" "bookings"."DisputeStatus" NOT NULL DEFAULT 'filed',
    "resolution_type" "bookings"."DisputeResolutionType",
    "refund_amount_paise" INTEGER,
    "admin_notes" TEXT,
    "resolved_by" UUID,
    "filed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution_deadline" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."wallet_credits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source_type" "wallet"."WalletCreditSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disputes_dispute_ref_key" ON "bookings"."disputes"("dispute_ref");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "bookings"."disputes"("status");

-- CreateIndex
CREATE INDEX "disputes_booking_id_idx" ON "bookings"."disputes"("booking_id");

-- CreateIndex
CREATE INDEX "disputes_property_id_status_idx" ON "bookings"."disputes"("property_id", "status");

-- CreateIndex
CREATE INDEX "wallet_credits_user_id_idx" ON "wallet"."wallet_credits"("user_id");
