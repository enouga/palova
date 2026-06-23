-- CreateTable
CREATE TABLE "club_broadcasts" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "sent_by_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "recipient_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_broadcasts_club_id_created_at_idx" ON "club_broadcasts"("club_id", "created_at");

-- AddForeignKey
ALTER TABLE "club_broadcasts" ADD CONSTRAINT "club_broadcasts_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
