-- The 20260610000000_multi_schema_and_cleanup migration moved the
-- auth.users / auth.sessions / auth.user_property_roles tables into the
-- "auth" schema, but left the GlobalRole, PropertyRole and UserStatus enum
-- types behind in "public". schema.prisma declares @@schema("auth") for
-- these enums, so Prisma generates SQL that casts to "auth"."PropertyRole"
-- etc., which fails with "type does not exist" since the types are still
-- in "public".

ALTER TYPE "public"."GlobalRole" SET SCHEMA "auth";
ALTER TYPE "public"."PropertyRole" SET SCHEMA "auth";
ALTER TYPE "public"."UserStatus" SET SCHEMA "auth";
