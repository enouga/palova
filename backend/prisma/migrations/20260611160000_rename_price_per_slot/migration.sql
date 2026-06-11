-- Le prix d'une ressource devient le prix du CRÉNEAU (la réservation), plus un tarif horaire.
-- Renommage pur : les valeurs existantes gardent leur montant (25 = 25 € le créneau).
ALTER TABLE "resources" RENAME COLUMN "price_per_hour" TO "price";
ALTER TABLE "resources" RENAME COLUMN "off_peak_price_per_hour" TO "off_peak_price";
