-- CreateEnum
CREATE TYPE "reviews"."ReviewStatus" AS ENUM ('pending', 'published', 'flagged', 'removed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notifications"."NotificationType" ADD VALUE 'review_new_on_property';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'review_reply_window_reminder';

-- AlterTable
ALTER TABLE "properties"."properties" ADD COLUMN     "rating_avg" DOUBLE PRECISION,
ADD COLUMN     "rating_breakdown" JSONB,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating_dimensions" JSONB;

-- CreateTable
CREATE TABLE "reviews"."reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "score_overall" INTEGER NOT NULL,
    "score_cleanliness" INTEGER NOT NULL,
    "score_amenities" INTEGER NOT NULL,
    "score_accuracy" INTEGER NOT NULL,
    "score_value" INTEGER NOT NULL,
    "score_checkin" INTEGER NOT NULL,
    "display_score" DECIMAL(3,2) NOT NULL,
    "review_text" TEXT,
    "photo_urls" TEXT[],
    "status" "reviews"."ReviewStatus" NOT NULL DEFAULT 'pending',
    "owner_reply" TEXT,
    "owner_replied_at" TIMESTAMP(3),
    "reply_window_end" TIMESTAMP(3),
    "reply_reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "window_opens_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "prompt_sent_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews"."review_flags" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "flagged_by" UUID NOT NULL,
    "flag_role" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews"."review_audit_log" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "reviews"."ReviewStatus",
    "to_status" "reviews"."ReviewStatus",
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"."reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_property_id_status_idx" ON "reviews"."reviews"("property_id", "status");

-- CreateIndex
CREATE INDEX "reviews_guest_id_idx" ON "reviews"."reviews"("guest_id");

-- CreateIndex
CREATE INDEX "reviews_status_window_opens_at_idx" ON "reviews"."reviews"("status", "window_opens_at");

-- CreateIndex
CREATE INDEX "reviews_status_expires_at_idx" ON "reviews"."reviews"("status", "expires_at");

-- CreateIndex
CREATE INDEX "review_flags_review_id_idx" ON "reviews"."review_flags"("review_id");

-- CreateIndex
CREATE INDEX "review_audit_log_review_id_idx" ON "reviews"."review_audit_log"("review_id");

-- AddForeignKey
ALTER TABLE "reviews"."review_flags" ADD CONSTRAINT "review_flags_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"."reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews"."review_audit_log" ADD CONSTRAINT "review_audit_log_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"."reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
