-- Phase 2A onboarding contract (additive, non-destructive).

-- 1. BusinessEntity enum (properties schema) + Step-1 column on Property.
CREATE TYPE "properties"."BusinessEntity" AS ENUM (
  'individual',
  'sole_proprietor',
  'partnership',
  'llp',
  'private_limited',
  'public_limited'
);

ALTER TABLE "properties"."properties"
  ADD COLUMN "business_entity" "properties"."BusinessEntity";

-- 2. New DocumentType values (compliance schema). ADD VALUE is transactional
--    on Postgres 12+ as long as the new values are not used in this migration.
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'partnership_deed';
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'incorporation_certificate';
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'board_resolution';
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'llp_agreement';
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'cancelled_cheque';

-- 3. Make GSTIN columns nullable so "no GSTIN" is representable. gstin_hash
--    keeps its UNIQUE index; NULLs never collide in Postgres.
ALTER TABLE "compliance"."property_compliance_docs"
  ALTER COLUMN "gstin_encrypted" DROP NOT NULL;
ALTER TABLE "compliance"."property_compliance_docs"
  ALTER COLUMN "gstin_hash" DROP NOT NULL;
