-- Garde SIRET à la création de club + détection des clubs fantômes (additif, nullable).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "siret" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "siret_verified_at" TIMESTAMP(3);
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "siret_legal_name" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "setup_reminder_sent_at" TIMESTAMP(3);
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "auto_suspended_at" TIMESTAMP(3);
