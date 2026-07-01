-- Ajoute le côté d'équipe (padel) sur les participants de réservation. Additif, nullable.
ALTER TABLE "reservation_participants" ADD COLUMN "team" INTEGER;
