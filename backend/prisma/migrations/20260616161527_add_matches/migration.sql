-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchPlayerConfirmation" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED');

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "played_at" TIMESTAMPTZ NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" TEXT NOT NULL,
    "sets" JSONB NOT NULL,
    "winning_team" INTEGER,
    "confirm_deadline" TIMESTAMP(3) NOT NULL,
    "ratings_applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team" INTEGER NOT NULL,
    "confirmation" "MatchPlayerConfirmation" NOT NULL DEFAULT 'PENDING',
    "rating_before" DOUBLE PRECISION,
    "rating_after" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matches_club_id_status_played_at_idx" ON "matches"("club_id", "status", "played_at");

-- CreateIndex
CREATE INDEX "matches_status_confirm_deadline_idx" ON "matches"("status", "confirm_deadline");

-- CreateIndex
CREATE INDEX "matches_reservation_id_idx" ON "matches"("reservation_id");

-- CreateIndex
CREATE INDEX "match_players_user_id_idx" ON "match_players"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_players_match_id_user_id_key" ON "match_players"("match_id", "user_id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
