-- Disponibilité au contact du J/A (réglage personnel, par club — miroir de is_referee).
DO $$ BEGIN
  CREATE TYPE "RefereeContactPolicy" AS ENUM ('ALWAYS', 'AFTER_DEADLINE', 'NEVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "club_subscribers" ADD COLUMN IF NOT EXISTS "referee_contact_policy" "RefereeContactPolicy" NOT NULL DEFAULT 'AFTER_DEADLINE';
