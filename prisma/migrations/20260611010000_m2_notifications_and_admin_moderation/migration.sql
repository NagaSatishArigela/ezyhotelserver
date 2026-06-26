-- M2 + M2B: Owner notification inbox + admin moderation.
-- Hand-written (DB unreachable locally for `prisma migrate dev`).

-- AlterEnum: PropertyStatus gains a terminal `escalated` value (revision
-- cycle cap, M2B spec edge case 3). Not referenced elsewhere in this
-- migration, so safe to add inside the migration transaction.
ALTER TYPE "properties"."PropertyStatus" ADD VALUE 'escalated';

-- CreateEnum
CREATE TYPE "properties"."ModerationAction" AS ENUM ('approved', 'rejected', 'revision_requested');

-- CreateTable: properties.property_moderation_log
CREATE TABLE "properties"."property_moderation_log" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" "properties"."ModerationAction" NOT NULL,
    "reason" TEXT,
    "revision_items" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_moderation_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_moderation_log_property_id_idx" ON "properties"."property_moderation_log"("property_id");

-- CreateEnum
CREATE TYPE "notifications"."NotificationType" AS ENUM ('status_change', 'revision_request', 'approval', 'rejection', 'document_verified', 'general');

-- CreateTable: notifications.owner_notifications
CREATE TABLE "notifications"."owner_notifications" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "property_id" UUID,
    "type" "notifications"."NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" VARCHAR(500),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_notifications_owner_id_is_read_idx" ON "notifications"."owner_notifications"("owner_id", "is_read");

-- CreateIndex
CREATE INDEX "owner_notifications_owner_id_created_at_idx" ON "notifications"."owner_notifications"("owner_id", "created_at");
