-- Lead-guest contact captured at booking time (nullable, additive)
ALTER TABLE "bookings"."bookings" ADD COLUMN "guest_name" TEXT;
ALTER TABLE "bookings"."bookings" ADD COLUMN "guest_phone" TEXT;
ALTER TABLE "bookings"."bookings" ADD COLUMN "guest_email" TEXT;
ALTER TABLE "bookings"."bookings" ADD COLUMN "special_requests" TEXT;
