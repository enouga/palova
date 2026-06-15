-- Migration manuelle : ajout Stripe Connect (ClubStripeCustomer, flags club, champs payment)

CREATE TYPE "StripeAccountStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'RESTRICTED');

ALTER TABLE "clubs"
  ADD COLUMN "stripe_account_id"        TEXT,
  ADD COLUMN "stripe_account_status"    "StripeAccountStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "require_online_payment"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "require_card_fingerprint" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payments"
  ADD COLUMN "stripe_payment_intent_id" TEXT,
  ADD COLUMN "stripe_payment_method_id" TEXT;

CREATE TABLE "club_stripe_customers" (
  "id"                        TEXT         NOT NULL,
  "club_id"                   TEXT         NOT NULL,
  "user_id"                   TEXT         NOT NULL,
  "stripe_customer_id"        TEXT         NOT NULL,
  "default_payment_method_id" TEXT,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "club_stripe_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "club_stripe_customers_club_id_user_id_key"
  ON "club_stripe_customers"("club_id", "user_id");
CREATE INDEX "club_stripe_customers_club_id_idx"
  ON "club_stripe_customers"("club_id");

ALTER TABLE "club_stripe_customers"
  ADD CONSTRAINT "club_stripe_customers_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "club_stripe_customers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
