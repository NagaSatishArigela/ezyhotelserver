-- CreateEnum
CREATE TYPE "bookings"."BookingAdminActionType" AS ENUM ('void', 'cancel', 'refund_full', 'refund_partial', 'force_checkout', 'extend', 'flag', 'unflag');

-- AlterEnum
ALTER TYPE "bookings"."BookingStatus" ADD VALUE 'voided';

-- AlterEnum
ALTER TYPE "bookings"."PaymentStatus" ADD VALUE 'refunded';

-- AlterTable
ALTER TABLE "bookings"."bookings" ADD COLUMN     "extension_amount_paise" INTEGER,
ADD COLUMN     "flag_notes" TEXT,
ADD COLUMN     "flag_type" TEXT,
ADD COLUMN     "is_flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMP(3),
ADD COLUMN     "voided_by" TEXT;

-- CreateTable
CREATE TABLE "bookings"."booking_admin_actions" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" "bookings"."BookingAdminActionType" NOT NULL,
    "reason_category" TEXT,
    "reason_text" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_admin_actions_booking_id_idx" ON "bookings"."booking_admin_actions"("booking_id");

-- CreateIndex
CREATE INDEX "bookings_is_flagged_idx" ON "bookings"."bookings"("is_flagged");
