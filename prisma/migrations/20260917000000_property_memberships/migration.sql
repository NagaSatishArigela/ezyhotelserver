ALTER TYPE "auth"."PropertyRole" ADD VALUE 'HOTEL_ADMIN';
CREATE TABLE "auth"."hotel_roles" (
 "id" UUID NOT NULL, "property_id" UUID NOT NULL, "name" VARCHAR(80) NOT NULL,
 "permissions" TEXT[] NOT NULL, CONSTRAINT "hotel_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hotel_roles_property_id_name_key" ON "auth"."hotel_roles"("property_id", "name");
ALTER TABLE "auth"."user_property_roles" ADD COLUMN "hotel_role_id" UUID;
ALTER TABLE "auth"."user_property_roles" ADD CONSTRAINT "user_property_roles_hotel_role_id_fkey" FOREIGN KEY ("hotel_role_id") REFERENCES "auth"."hotel_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DELETE FROM "auth"."user_property_roles" m USING "properties"."properties" p
WHERE m.property_id = p.id AND m.role = 'OWNER' AND (p.status NOT IN ('approved', 'suspended') OR m.user_id <> p.owner_id);
INSERT INTO "auth"."user_property_roles" (id, user_id, property_id, role, created_at)
SELECT gen_random_uuid(), owner_id, id, 'OWNER', NOW() FROM "properties"."properties" WHERE status IN ('approved', 'suspended')
ON CONFLICT (user_id, property_id) DO UPDATE SET role = 'OWNER', hotel_role_id = NULL;
