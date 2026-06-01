-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "member_booking_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "public_booking_days" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "club_subscribers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_subscribers_club_id_idx" ON "club_subscribers"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_subscribers_user_id_club_id_key" ON "club_subscribers"("user_id", "club_id");

-- AddForeignKey
ALTER TABLE "club_subscribers" ADD CONSTRAINT "club_subscribers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscribers" ADD CONSTRAINT "club_subscribers_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
