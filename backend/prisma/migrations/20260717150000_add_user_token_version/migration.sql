-- Revocation d'identite JWT (audit pre-MEP §2.2) : incremente a la suppression de compte
-- (RGPD) ou a la reinitialisation du mot de passe -> un token signe avec une version
-- anterieure est rejete par authMiddleware/optionalAuth. Defaut 0 = tous les tokens
-- deja emis (qui n'ont pas de champ tokenVersion) restent valides tant que non revoques.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0;
