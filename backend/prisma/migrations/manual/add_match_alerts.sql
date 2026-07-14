-- add_match_alerts : alertes ponctuelles datées pour parties ouvertes.
CREATE TABLE IF NOT EXISTS "match_alerts" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "club_id"      TEXT NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "window_end"   TIMESTAMPTZ NOT NULL,
  "created_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "match_alerts_club_id_window_end_idx" ON "match_alerts"("club_id", "window_end");
CREATE INDEX IF NOT EXISTS "match_alerts_user_id_idx" ON "match_alerts"("user_id");

CREATE TABLE IF NOT EXISTS "match_alert_hits" (
  "id"             TEXT NOT NULL,
  "alert_id"       TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "created_at"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_alert_hits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "match_alert_hits_alert_id_reservation_id_key" ON "match_alert_hits"("alert_id", "reservation_id");
CREATE INDEX IF NOT EXISTS "match_alert_hits_reservation_id_idx" ON "match_alert_hits"("reservation_id");

DO $$ BEGIN
  ALTER TABLE "match_alerts" ADD CONSTRAINT "match_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "match_alerts" ADD CONSTRAINT "match_alerts_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "match_alert_hits" ADD CONSTRAINT "match_alert_hits_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "match_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "match_alert_hits" ADD CONSTRAINT "match_alert_hits_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
