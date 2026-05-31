-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'CLUB_ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "club_id" TEXT,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'CLIENT';

-- CreateIndex
CREATE INDEX "users_club_id_idx" ON "users"("club_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
