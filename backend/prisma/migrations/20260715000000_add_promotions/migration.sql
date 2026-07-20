-- add_promotions : promotions datées sur les terrains (remise % ou prix fixe).
DO $$ BEGIN
  CREATE TYPE "PromotionKind" AS ENUM ('PERCENT', 'FIXED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "promotions" (
  "id"           TEXT NOT NULL,
  "club_id"      TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "start_date"   DATE NOT NULL,
  "end_date"     DATE NOT NULL,
  "window_start" INTEGER,
  "window_end"   INTEGER,
  "kind"         "PromotionKind" NOT NULL,
  "percent_off"  INTEGER,
  "fixed_price"  DECIMAL(10,2),
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "promotions_club_id_idx" ON "promotions"("club_id");

CREATE TABLE IF NOT EXISTS "promotion_resources" (
  "promotion_id" TEXT NOT NULL,
  "resource_id"  TEXT NOT NULL,
  CONSTRAINT "promotion_resources_pkey" PRIMARY KEY ("promotion_id", "resource_id")
);
CREATE INDEX IF NOT EXISTS "promotion_resources_resource_id_idx" ON "promotion_resources"("resource_id");

DO $$ BEGIN
  ALTER TABLE "promotions" ADD CONSTRAINT "promotions_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "promotion_resources" ADD CONSTRAINT "promotion_resources_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "promotion_resources" ADD CONSTRAINT "promotion_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
