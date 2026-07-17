-- Facette « juge-arbitre » du membre (miroir de ClubMembership.watch)
ALTER TABLE "club_subscribers" ADD COLUMN IF NOT EXISTS "is_referee" BOOLEAN NOT NULL DEFAULT false;

-- Mission : le J/A désigné de ce tournoi
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "referee_user_id" TEXT;
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_referee_user_id_fkey"
  FOREIGN KEY ("referee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "tournaments_referee_user_id_idx" ON "tournaments"("referee_user_id");
