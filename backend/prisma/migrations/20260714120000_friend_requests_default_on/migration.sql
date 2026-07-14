-- Opt-in demandes d'ami : défaut ON + backfill (personne n'avait explicitement choisi OFF,
-- c'était le défaut — l'interrupteur du profil reste pour se retirer).
ALTER TABLE users ALTER COLUMN "accepts_friend_requests" SET DEFAULT true;
UPDATE users SET "accepts_friend_requests" = true;
