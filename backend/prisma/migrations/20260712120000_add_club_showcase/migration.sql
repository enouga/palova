-- Vitrine club : année de création + équipements (catalogue fermé)
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "founded_year" INTEGER;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "amenities" TEXT[] NOT NULL DEFAULT '{}';
