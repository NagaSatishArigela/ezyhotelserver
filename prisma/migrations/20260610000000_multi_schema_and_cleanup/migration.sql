-- Modular monolith data isolation: introduce per-domain Postgres schemas and
-- relocate existing tables into their owning domain. Cross-schema foreign
-- keys are dropped - cross-domain references are plain UUID columns from
-- here on (resolved via application code / events, not SQL JOINs).

-- 1. Create domain schemas (idempotent)
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "properties";
CREATE SCHEMA IF NOT EXISTS "bookings";
CREATE SCHEMA IF NOT EXISTS "finance";
CREATE SCHEMA IF NOT EXISTS "notifications";
CREATE SCHEMA IF NOT EXISTS "reviews";
CREATE SCHEMA IF NOT EXISTS "compliance";

-- 2. Move existing tables out of "public" into their domain schema
ALTER TABLE "public"."users" SET SCHEMA "auth";
ALTER TABLE "public"."sessions" SET SCHEMA "auth";
ALTER TABLE "public"."user_property_roles" SET SCHEMA "auth";
ALTER TABLE "public"."properties" SET SCHEMA "properties";

-- 3. Drop the unused/vestigial "otps" table (Redis is the canonical OTP store)
DROP TABLE IF EXISTS "public"."otps";

-- 4. Drop dead refresh-token columns on users (refresh tokens live only in
--    auth.sessions.refresh_token_hash)
ALTER TABLE "auth"."users" DROP COLUMN IF EXISTS "refresh_token_hash";
ALTER TABLE "auth"."users" DROP COLUMN IF EXISTS "refresh_token_expires_at";

-- 5. Drop cross-schema foreign keys (data-isolation requirement: no FK
--    constraints between domain schemas). Application code now enforces
--    referential integrity for these via service-level checks/events.
ALTER TABLE "properties"."properties" DROP CONSTRAINT IF EXISTS "properties_owner_id_fkey";
ALTER TABLE "auth"."user_property_roles" DROP CONSTRAINT IF EXISTS "user_property_roles_property_id_fkey";
