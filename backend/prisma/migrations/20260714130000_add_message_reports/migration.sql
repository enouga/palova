DO $$ BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'ILLEGAL', 'SPAM', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportResolution" AS ENUM ('DELETED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "message_reports" (
  "id" TEXT NOT NULL,
  "open_match_message_id" TEXT,
  "direct_message_id" TEXT,
  "reporter_id" TEXT NOT NULL,
  "club_id" TEXT,
  "reason" "ReportReason" NOT NULL,
  "detail" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolution" "ReportResolution",
  "resolved_by_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_reports_open_match_message_id_reporter_id_key" ON "message_reports"("open_match_message_id", "reporter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "message_reports_direct_message_id_reporter_id_key" ON "message_reports"("direct_message_id", "reporter_id");
CREATE INDEX IF NOT EXISTS "message_reports_club_id_status_idx" ON "message_reports"("club_id", "status");
CREATE INDEX IF NOT EXISTS "message_reports_status_idx" ON "message_reports"("status");

DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_open_match_message_id_fkey"
    FOREIGN KEY ("open_match_message_id") REFERENCES "open_match_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_direct_message_id_fkey"
    FOREIGN KEY ("direct_message_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
