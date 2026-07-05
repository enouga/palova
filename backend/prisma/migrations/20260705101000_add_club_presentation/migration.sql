-- Présentation du club : texte long, contact, horaires, opt-in offres publiques, galerie photos.
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "presentation_text" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "opening_hours_text" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "show_offers_publicly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "club_photos" (
  "id" TEXT NOT NULL,
  "club_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "caption" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "club_photos_club_id_idx" ON "club_photos"("club_id");
DO $$ BEGIN
  ALTER TABLE "club_photos" ADD CONSTRAINT "club_photos_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
