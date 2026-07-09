-- Vitesse d'auto-défilement du kiosque « À la une » du Club-house (secondes ; 0 = manuel).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "club_house_kiosk_seconds" INTEGER NOT NULL DEFAULT 6;
