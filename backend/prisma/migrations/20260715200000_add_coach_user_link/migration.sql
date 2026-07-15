-- add_coach_user_link : rattache un Coach à un compte membre (nom/photo dérivés du profil).
ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "coaches" ADD CONSTRAINT "coaches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "coaches_club_id_user_id_key" ON "coaches"("club_id", "user_id");
