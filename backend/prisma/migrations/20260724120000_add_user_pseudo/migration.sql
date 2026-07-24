-- Pseudo optionnel, unique sur la plateforme (comparaison insensible à la casse faite en
-- appli, cf. PATCH /api/me) — affiché à la place du prénom/nom dans les parties ouvertes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pseudo" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "users_pseudo_key" ON "users"("pseudo");
