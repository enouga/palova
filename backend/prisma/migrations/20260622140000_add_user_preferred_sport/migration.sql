ALTER TABLE "users" ADD COLUMN "preferred_sport_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_sport_id_fkey"
  FOREIGN KEY ("preferred_sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
