-- add_match_alert_level : fourchette de niveau optionnelle sur une alerte de partie.
ALTER TABLE "match_alerts" ADD COLUMN IF NOT EXISTS "target_level_min" DOUBLE PRECISION;
ALTER TABLE "match_alerts" ADD COLUMN IF NOT EXISTS "target_level_max" DOUBLE PRECISION;
