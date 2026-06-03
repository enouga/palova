-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- AlterTable : la table physique reste "club_subscribers" (mappée sur le modèle ClubMembership).
-- Migration purement additive : l'ancien « abonné » devient la colonne is_subscriber.
ALTER TABLE "club_subscribers"
  ADD COLUMN "is_subscriber" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "membership_no" TEXT,
  ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "note" TEXT;

-- Les lignes existantes étaient des abonnés (perk « fenêtre de résa élargie »).
UPDATE "club_subscribers" SET "is_subscriber" = true;

-- Backfill accès : tout joueur ayant déjà réservé devient membre ACTIVE de ce club
-- (sinon le nouveau gating « membre = peut réserver » leur couperait l'accès).
INSERT INTO "club_subscribers" ("id", "user_id", "club_id", "created_at", "is_subscriber", "status")
SELECT gen_random_uuid()::text, sub."user_id", sub."club_id", CURRENT_TIMESTAMP, false, 'ACTIVE'
FROM (
  SELECT DISTINCT r."user_id", res."club_id"
  FROM "reservations" r
  JOIN "resources" res ON res."id" = r."resource_id"
) sub
ON CONFLICT ("user_id", "club_id") DO NOTHING;

-- Backfill accès : le staff (club_members) devient aussi membre ACTIVE.
INSERT INTO "club_subscribers" ("id", "user_id", "club_id", "created_at", "is_subscriber", "status")
SELECT gen_random_uuid()::text, cm."user_id", cm."club_id", CURRENT_TIMESTAMP, false, 'ACTIVE'
FROM "club_members" cm
ON CONFLICT ("user_id", "club_id") DO NOTHING;
