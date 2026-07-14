ALTER TABLE "open_match_messages" ADD COLUMN IF NOT EXISTS "edited_at" TIMESTAMP(3);
ALTER TABLE "direct_messages" ADD COLUMN IF NOT EXISTS "edited_at" TIMESTAMP(3);
