-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_user_id" TEXT,
ADD COLUMN     "cancelled_reason" TEXT;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
