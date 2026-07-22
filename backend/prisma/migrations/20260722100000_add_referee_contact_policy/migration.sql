-- Disponibilité au contact du J/A (réglage personnel, par club — miroir de is_referee).
CREATE TYPE "RefereeContactPolicy" AS ENUM ('ALWAYS', 'AFTER_DEADLINE', 'NEVER');
ALTER TABLE "club_subscribers" ADD COLUMN IF NOT EXISTS "referee_contact_policy" "RefereeContactPolicy" NOT NULL DEFAULT 'AFTER_DEADLINE';
