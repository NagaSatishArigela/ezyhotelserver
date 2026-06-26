-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateTable
CREATE TABLE "platform"."platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "tds_pct" DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    "payout_day_of_week" INTEGER NOT NULL DEFAULT 1,
    "min_booking_hours" INTEGER NOT NULL DEFAULT 1,
    "max_booking_hours" INTEGER NOT NULL DEFAULT 24,
    "cancellation_window_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
