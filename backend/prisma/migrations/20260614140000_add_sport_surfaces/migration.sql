-- Matériaux proposés par sport (béton poreux, résine…). Additif, défaut vide.
ALTER TABLE "sports" ADD COLUMN "surfaces" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
