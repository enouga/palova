-- Sections du Club-house configurables par le club (ordre + visibilité).
-- null = ordre adaptatif par défaut (visiteur/membre).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "club_house_sections" JSONB;
