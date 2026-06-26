-- CreateEnum
CREATE TYPE "bookings"."BookingType" AS ENUM ('hourly', 'fullday');

-- CreateEnum
CREATE TYPE "bookings"."BookingStatus" AS ENUM ('pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "bookings"."PaymentStatus" AS ENUM ('pending', 'success', 'failed');

-- AlterEnum
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'booking_update';

-- AlterTable
ALTER TABLE "properties"."properties" ALTER COLUMN "amenities" DROP DEFAULT;

-- CreateTable
CREATE TABLE "bookings"."bookings" (
    "id" UUID NOT NULL,
    "booking_ref" TEXT NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "bookingType" "bookings"."BookingType" NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3) NOT NULL,
    "duration_hours" INTEGER NOT NULL,
    "guest_count" INTEGER NOT NULL,
    "base_amount_paise" INTEGER NOT NULL,
    "gst_amount_paise" INTEGER NOT NULL,
    "platform_fee_paise" INTEGER NOT NULL,
    "total_amount_paise" INTEGER NOT NULL,
    "status" "bookings"."BookingStatus" NOT NULL DEFAULT 'pending_payment',
    "payment_status" "bookings"."PaymentStatus" NOT NULL DEFAULT 'pending',
    "payment_ref" TEXT,
    "qr_code" TEXT,
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "refund_amount_paise" INTEGER,
    "no_show_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_ref_key" ON "bookings"."bookings"("booking_ref");

-- CreateIndex
CREATE INDEX "bookings_property_id_check_in_at_check_out_at_idx" ON "bookings"."bookings"("property_id", "check_in_at", "check_out_at");

-- CreateIndex
CREATE INDEX "bookings_guest_id_idx" ON "bookings"."bookings"("guest_id");

-- CreateIndex
CREATE INDEX "bookings_owner_id_idx" ON "bookings"."bookings"("owner_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"."bookings"("status");
