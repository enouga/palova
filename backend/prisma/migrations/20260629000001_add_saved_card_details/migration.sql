-- Détails de la carte enregistrée (affichage « Visa •••• 4242 · exp 04/27 »).
-- Additif, nullable, backfill paresseux côté lecture.
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_brand" TEXT;
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_last4" TEXT;
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_exp_month" INTEGER;
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_exp_year" INTEGER;
