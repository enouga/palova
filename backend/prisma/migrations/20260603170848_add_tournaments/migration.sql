-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "TournamentGender" AS ENUM ('MEN', 'WOMEN', 'MIXED');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sex" "Sex";

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "club_sport_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "gender" "TournamentGender" NOT NULL,
    "description" TEXT,
    "start_time" TIMESTAMPTZ NOT NULL,
    "end_time" TIMESTAMPTZ,
    "registration_deadline" TIMESTAMPTZ NOT NULL,
    "max_teams" INTEGER,
    "entry_fee" DECIMAL(10,2),
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_registrations" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "captain_user_id" TEXT NOT NULL,
    "partner_user_id" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournaments_club_id_idx" ON "tournaments"("club_id");

-- CreateIndex
CREATE INDEX "tournaments_club_id_status_start_time_idx" ON "tournaments"("club_id", "status", "start_time");

-- CreateIndex
CREATE INDEX "tournament_registrations_tournament_id_status_created_at_idx" ON "tournament_registrations"("tournament_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "tournament_registrations_captain_user_id_idx" ON "tournament_registrations"("captain_user_id");

-- CreateIndex
CREATE INDEX "tournament_registrations_partner_user_id_idx" ON "tournament_registrations"("partner_user_id");

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_sport_id_fkey" FOREIGN KEY ("club_sport_id") REFERENCES "club_sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_captain_user_id_fkey" FOREIGN KEY ("captain_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
