-- Mediation de la consommation (art. L612-1 code conso) : nom + site du mediateur du club,
-- injectes dans le modele CGV et saisis dans /admin/pages (Coordonnees legales).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "mediator_name" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "mediator_url" TEXT;
