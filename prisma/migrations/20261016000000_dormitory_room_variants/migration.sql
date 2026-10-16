-- Multiple named dormitory variants share the dorm category; bookings already reference room IDs.
DROP INDEX "properties"."room_types_property_id_type_key";
CREATE INDEX "room_types_property_id_type_idx" ON "properties"."room_types"("property_id", "type");
