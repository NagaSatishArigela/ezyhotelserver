-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "properties_city_idx" ON "properties"."properties"("city");

-- CreateIndex
CREATE INDEX "properties_name_idx" ON "properties"."properties" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "properties_description_idx" ON "properties"."properties" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "properties_landmark_idx" ON "properties"."properties" USING GIN ("landmark" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "properties_amenities_idx" ON "properties"."properties" USING GIN ("amenities");
