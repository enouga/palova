-- add_match_competitive : type Amicale/Compétitive d'une partie (gate le niveau du résultat).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "competitive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "competitive" BOOLEAN NOT NULL DEFAULT true;
