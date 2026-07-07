-- add_platform_billing : facturation SaaS Palova (offre au membre actif). 100 % additif.

ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "platform_customer_id" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "active_member_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "active_member_count_at" TIMESTAMP(3);
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "billing_exempt" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "platform_subscriptions" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "interval" TEXT NOT NULL,
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscriptions_club_id_key" ON "platform_subscriptions"("club_id");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscriptions_stripe_subscription_id_key" ON "platform_subscriptions"("stripe_subscription_id");
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "club_member_snapshots" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "active_members" INTEGER NOT NULL,
    "observed_tier" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "club_member_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "club_member_snapshots_club_id_month_key" ON "club_member_snapshots"("club_id", "month");
ALTER TABLE "club_member_snapshots" ADD CONSTRAINT "club_member_snapshots_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
