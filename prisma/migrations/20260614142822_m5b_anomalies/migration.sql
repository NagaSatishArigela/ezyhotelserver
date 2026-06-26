-- CreateEnum
CREATE TYPE "bookings"."AnomalySeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "bookings"."AnomalyEntityType" AS ENUM ('property', 'customer', 'booking');

-- CreateEnum
CREATE TYPE "bookings"."AnomalyStatus" AS ENUM ('detected', 'investigating', 'resolved_action', 'resolved_fp', 'escalated');

-- CreateTable
CREATE TABLE "bookings"."anomalies" (
    "id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "severity" "bookings"."AnomalySeverity" NOT NULL,
    "entity_type" "bookings"."AnomalyEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "bookings"."AnomalyStatus" NOT NULL DEFAULT 'detected',
    "resolution_type" TEXT,
    "resolution_notes" TEXT,
    "resolved_by" UUID,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anomalies_status_severity_idx" ON "bookings"."anomalies"("status", "severity");

-- CreateIndex
CREATE INDEX "anomalies_rule_id_entity_type_entity_id_idx" ON "bookings"."anomalies"("rule_id", "entity_type", "entity_id");
