-- AlterTable
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "list_open_matches_nationally" BOOLEAN NOT NULL DEFAULT false;
