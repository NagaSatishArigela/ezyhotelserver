ALTER TYPE "properties"."PropertyType" ADD VALUE IF NOT EXISTS 'guest_house';
ALTER TYPE "properties"."PropertyType" ADD VALUE IF NOT EXISTS 'lodge';
ALTER TYPE "properties"."PropertyType" ADD VALUE IF NOT EXISTS 'dormitory';
ALTER TABLE "properties"."properties" ADD COLUMN "other_accommodation" JSONB;
ALTER TABLE "properties"."room_types" ADD COLUMN "dormitory" JSONB;
