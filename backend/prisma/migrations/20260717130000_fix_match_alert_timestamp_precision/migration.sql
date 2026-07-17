-- Corrige une dérive de précision : les migrations manuscrites add_match_alerts créaient
-- `created_at` en TIMESTAMP (précision 6) alors que Prisma attend TIMESTAMP(3) pour un
-- DateTime. Fonctionnellement inoffensif, mais laissé tel quel un futur `migrate dev`
-- régénérerait ce correctif par surprise. Aligne la base sur le schéma.
ALTER TABLE "match_alert_hits" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "match_alerts" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);
