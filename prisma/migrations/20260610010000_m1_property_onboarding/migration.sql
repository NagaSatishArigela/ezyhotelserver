-- M1 Hotel Onboarding (Property Submission): adds onboarding workflow
-- columns to properties.properties, plus new tables for room types,
-- photos, and compliance documents (properties + compliance schemas).
-- Hand-written (DB unreachable locally for `prisma migrate dev`).

-- CreateEnum
CREATE TYPE "properties"."PropertyStatus" AS ENUM ('draft', 'pending_review', 'needs_revision', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "properties"."PropertyType" AS ENUM ('hotel', 'resort', 'homestay', 'villa', 'pg', 'farm', 'banquet', 'other');

-- CreateEnum
CREATE TYPE "properties"."BookingPolicy" AS ENUM ('hourly', 'fullday', 'both');

-- CreateEnum
CREATE TYPE "properties"."PropertyCategory" AS ENUM ('budget', 'mid', 'premium');

-- CreateEnum
CREATE TYPE "properties"."DeletionTrack" AS ENUM ('fast_72h', 'standard_30d');

-- CreateEnum
CREATE TYPE "properties"."RoomTypeCategory" AS ENUM ('ac', 'nonac', 'dorm', 'suite');

-- CreateEnum
CREATE TYPE "compliance"."DocumentType" AS ENUM ('owner_photo', 'id_proof', 'pan_card', 'gstin_certificate', 'rental_agreement', 'fire_safety_cert', 'fssai_license', 'trade_license', 'other');

-- CreateEnum
CREATE TYPE "compliance"."DocumentStatus" AS ENUM ('pending', 'verified', 'rejected', 'expired');

-- AlterTable: properties.properties - onboarding workflow + wizard fields
ALTER TABLE "properties"."properties"
    ADD COLUMN "status" "properties"."PropertyStatus" NOT NULL DEFAULT 'draft',
    ADD COLUMN "draft_step" INTEGER,
    ADD COLUMN "draft_data" JSONB,
    ADD COLUMN "submission_ref" TEXT,
    ADD COLUMN "submitted_at" TIMESTAMP(3),
    ADD COLUMN "revision_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "revision_notes" JSONB,
    ADD COLUMN "property_type" "properties"."PropertyType",
    ADD COLUMN "booking_policy" "properties"."BookingPolicy",
    ADD COLUMN "category" "properties"."PropertyCategory",
    ADD COLUMN "description" VARCHAR(200),
    ADD COLUMN "owner_first_name" TEXT,
    ADD COLUMN "owner_middle_name" TEXT,
    ADD COLUMN "owner_last_name" TEXT,
    ADD COLUMN "address_line1" TEXT,
    ADD COLUMN "address_line2" TEXT,
    ADD COLUMN "city" TEXT,
    ADD COLUMN "state" TEXT,
    ADD COLUMN "pincode" TEXT,
    ADD COLUMN "landmark" TEXT,
    ADD COLUMN "special_note" VARCHAR(200),
    ADD COLUMN "latitude" DECIMAL(9,6),
    ADD COLUMN "longitude" DECIMAL(9,6),
    ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "house_rules" JSONB,
    ADD COLUMN "min_booking_hours" INTEGER,
    ADD COLUMN "default_checkin_time" VARCHAR(5),
    ADD COLUMN "default_checkout_time" VARCHAR(5),
    ADD COLUMN "seating_capacity" INTEGER,
    ADD COLUMN "deletion_requested_at" TIMESTAMP(3),
    ADD COLUMN "deletion_scheduled_for" TIMESTAMP(3),
    ADD COLUMN "deletion_track" "properties"."DeletionTrack",
    ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "properties_submission_ref_key" ON "properties"."properties"("submission_ref");

-- CreateIndex
CREATE INDEX "properties_status_idx" ON "properties"."properties"("status");

-- CreateTable: properties.room_types
CREATE TABLE "properties"."room_types" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "type" "properties"."RoomTypeCategory" NOT NULL,
    "count" INTEGER NOT NULL,
    "hourly_rate_paise" INTEGER,
    "fullday_rate_paise" INTEGER,
    "max_occupancy" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_types_property_id_idx" ON "properties"."room_types"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_property_id_type_key" ON "properties"."room_types"("property_id", "type");

-- CreateTable: properties.property_photos
CREATE TABLE "properties"."property_photos" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "url" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_photos_property_id_idx" ON "properties"."property_photos"("property_id");

-- CreateIndex
CREATE INDEX "property_photos_property_id_category_idx" ON "properties"."property_photos"("property_id", "category");

-- CreateTable: compliance.property_compliance_docs
CREATE TABLE "compliance"."property_compliance_docs" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "legal_business_name" TEXT NOT NULL,
    "gstin_encrypted" TEXT NOT NULL,
    "gstin_hash" TEXT NOT NULL,
    "pan_encrypted" TEXT NOT NULL,
    "pan_hash" TEXT NOT NULL,
    "bank_account_number_encrypted" TEXT NOT NULL,
    "bank_account_number_hash" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "tc_accepted_at" TIMESTAMP(3) NOT NULL,
    "form_c_acknowledged_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_compliance_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_compliance_docs_property_id_key" ON "compliance"."property_compliance_docs"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_compliance_docs_gstin_hash_key" ON "compliance"."property_compliance_docs"("gstin_hash");

-- CreateIndex
CREATE INDEX "property_compliance_docs_pan_hash_idx" ON "compliance"."property_compliance_docs"("pan_hash");

-- CreateTable: compliance.property_documents
CREATE TABLE "compliance"."property_documents" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "type" "compliance"."DocumentType" NOT NULL,
    "url" TEXT NOT NULL,
    "status" "compliance"."DocumentStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_documents_property_id_idx" ON "compliance"."property_documents"("property_id");

-- CreateIndex
CREATE INDEX "property_documents_property_id_type_idx" ON "compliance"."property_documents"("property_id", "type");
