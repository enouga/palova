-- Sport(s) tagué(s) sur une offre carnet/porte-monnaie (affichage seulement, tableau vide = tous sports).
ALTER TABLE "package_templates" ADD COLUMN "sport_keys" TEXT[] NOT NULL DEFAULT '{}';
