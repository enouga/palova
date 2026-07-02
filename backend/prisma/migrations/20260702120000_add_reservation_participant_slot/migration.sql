-- Ajoute la place G/D au sein de l'équipe (padel) sur les participants de réservation.
-- Additif, nullable.
ALTER TABLE "reservation_participants" ADD COLUMN IF NOT EXISTS "slot" INTEGER;
