-- Annonces enrichies : type + fin d'affichage (additif, idempotent).
DO $$ BEGIN
  CREATE TYPE "AnnouncementKind" AS ENUM ('INFO', 'OFFER', 'TOURNAMENT', 'EVENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "kind" "AnnouncementKind" NOT NULL DEFAULT 'INFO';
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "valid_until" TIMESTAMP(3);
