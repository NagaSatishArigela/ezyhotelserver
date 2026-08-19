-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "support";

-- CreateEnum
CREATE TYPE "support"."SupportTicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'escalated');

-- CreateEnum
CREATE TYPE "support"."SupportTicketPriority" AS ENUM ('low', 'medium', 'high');

-- AlterEnum
ALTER TYPE "auth"."GlobalRole" ADD VALUE 'SUPPORT';

-- CreateTable
CREATE TABLE "support"."support_tickets" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "support"."SupportTicketStatus" NOT NULL DEFAULT 'open',
    "priority" "support"."SupportTicketPriority" NOT NULL DEFAULT 'medium',
    "category" VARCHAR(60),
    "raised_by_user_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support"."support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_raised_by_user_id_idx" ON "support"."support_tickets"("raised_by_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_room_type_id_status_check_in_at_check_out_at_idx" ON "bookings"."bookings"("room_type_id", "status", "check_in_at", "check_out_at");
