-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'OPEN_MATCH_CHAT';

-- CreateTable
CREATE TABLE "open_match_interests" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "open_match_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_match_messages" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    CONSTRAINT "open_match_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "open_match_interests_reservation_id_user_id_key" ON "open_match_interests"("reservation_id", "user_id");
CREATE INDEX "open_match_interests_reservation_id_idx" ON "open_match_interests"("reservation_id");
CREATE INDEX "open_match_messages_reservation_id_created_at_idx" ON "open_match_messages"("reservation_id", "created_at");

-- AddForeignKey
ALTER TABLE "open_match_interests" ADD CONSTRAINT "open_match_interests_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "open_match_interests" ADD CONSTRAINT "open_match_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "open_match_messages" ADD CONSTRAINT "open_match_messages_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "open_match_messages" ADD CONSTRAINT "open_match_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
