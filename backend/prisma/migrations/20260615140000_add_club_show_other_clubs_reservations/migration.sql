-- Réglage club : « Mes réservations » affiche aussi les autres clubs du joueur (défaut : non).
ALTER TABLE "clubs" ADD COLUMN "show_other_clubs_reservations" BOOLEAN NOT NULL DEFAULT false;
