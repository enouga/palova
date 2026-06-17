-- Éclairage disponible pour ce sport (ex. tennis). Additif, défaut false.
ALTER TABLE "sports" ADD COLUMN "has_lighting" BOOLEAN NOT NULL DEFAULT false;
