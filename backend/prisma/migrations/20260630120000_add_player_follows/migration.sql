-- Ajoute la catégorie de notification sociale (suivi). Idempotent.
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'SOCIAL';

-- Table de suivi de joueur (friendship globale, sens unique).
CREATE TABLE "follows" (
  "id"           TEXT NOT NULL,
  "follower_id"  TEXT NOT NULL,
  "following_id" TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "follows_follower_id_following_id_key" ON "follows"("follower_id", "following_id");
CREATE INDEX "follows_following_id_idx" ON "follows"("following_id");

ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey"
  FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey"
  FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
