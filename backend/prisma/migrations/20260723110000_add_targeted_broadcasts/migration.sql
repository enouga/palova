-- Messages ciblés (spec 2026-07-23-messages-cibles-membres). Additif pur.
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'CLUB_OFFERS';
ALTER TABLE "club_broadcasts" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'INFO';

CREATE TABLE IF NOT EXISTS "club_broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    CONSTRAINT "club_broadcast_recipients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "club_broadcast_recipients_broadcast_id_user_id_key"
    ON "club_broadcast_recipients"("broadcast_id", "user_id");
CREATE INDEX IF NOT EXISTS "club_broadcast_recipients_user_id_idx" ON "club_broadcast_recipients"("user_id");
ALTER TABLE "club_broadcast_recipients"
    ADD CONSTRAINT "club_broadcast_recipients_broadcast_id_fkey"
    FOREIGN KEY ("broadcast_id") REFERENCES "club_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "club_broadcast_recipients"
    ADD CONSTRAINT "club_broadcast_recipients_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
