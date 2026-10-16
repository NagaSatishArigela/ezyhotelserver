ALTER TABLE "properties"."properties" ADD COLUMN "property_details" JSONB;
ALTER TABLE "compliance"."property_compliance_docs" ADD COLUMN "account_type" TEXT NOT NULL DEFAULT 'savings';
ALTER TABLE "compliance"."property_compliance_docs" ADD CONSTRAINT "property_compliance_docs_account_type_check" CHECK ("account_type" IN ('savings', 'current', 'cash_credit', 'other'));
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'id_proof_back';
ALTER TYPE "compliance"."DocumentType" ADD VALUE IF NOT EXISTS 'udyam_certificate';
