-- add_payment_no_show_flag : distingue un débit d'absence (no-show) d'un paiement normal,
-- pour notifier le joueur et suivre la récidive (audit fonctionnel P0 n°5).
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "no_show" BOOLEAN NOT NULL DEFAULT false;
