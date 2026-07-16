-- Ordre manuel des annonces (glisser-déposer). Additif, 0 par défaut (les existantes
-- restent triées par createdAt desc tant qu'on ne réordonne pas).
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;
