-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accepts_direct_messages" BOOLEAN NOT NULL DEFAULT true;
