-- add_platform_invoices : factures SaaS Stripe persistées (webhook + synchro superadmin). 100 % additif.

CREATE TABLE IF NOT EXISTS "platform_invoices" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "status" TEXT NOT NULL,
    "tier" INTEGER,
    "interval" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "hosted_invoice_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_invoices_stripe_invoice_id_key" ON "platform_invoices"("stripe_invoice_id");
CREATE INDEX IF NOT EXISTS "platform_invoices_club_id_idx" ON "platform_invoices"("club_id");

ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
