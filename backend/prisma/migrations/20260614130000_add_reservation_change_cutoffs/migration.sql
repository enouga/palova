-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "player_change_cutoff_hours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancellation_cutoff_hours" INTEGER NOT NULL DEFAULT 0;
