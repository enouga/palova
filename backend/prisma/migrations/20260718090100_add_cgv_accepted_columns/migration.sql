-- Etend la trace CGV (pattern Reservation.cgv_accepted_at) aux 3 autres parcours d'achat en ligne.
ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "cgv_accepted_at" TIMESTAMP(3);
ALTER TABLE "event_registrations" ADD COLUMN IF NOT EXISTS "cgv_accepted_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cgv_accepted_at" TIMESTAMP(3);
