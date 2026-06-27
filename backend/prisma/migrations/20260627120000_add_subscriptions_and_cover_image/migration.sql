-- Rattrapage de dérive : schéma présent dans schema.prisma (et en DB locale via `db push`)
-- mais sans fichier de migration → jamais appliqué en prod par `prisma migrate deploy`.
-- Contenu = diff exact (historique des migrations -> schema.prisma). Purement additif.

-- CreateEnum
CREATE TYPE "SubscriptionBenefit" AS ENUM ('INCLUDED', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'SUBSCRIPTION';

-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "cover_image_url" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "source_subscription_id" TEXT,
ADD COLUMN     "subscription_id" TEXT;

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport_keys" TEXT[],
    "monthly_price" DECIMAL(10,2) NOT NULL,
    "commitment_months" INTEGER NOT NULL,
    "off_peak_only" BOOLEAN NOT NULL DEFAULT true,
    "benefit" "SubscriptionBenefit" NOT NULL DEFAULT 'INCLUDED',
    "discount_percent" INTEGER,
    "daily_cap" INTEGER,
    "weekly_cap" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthly_price_snapshot" DECIMAL(10,2) NOT NULL,
    "sport_keys" TEXT[],
    "off_peak_only" BOOLEAN NOT NULL,
    "benefit" "SubscriptionBenefit" NOT NULL,
    "discount_percent" INTEGER,
    "daily_cap" INTEGER,
    "weekly_cap" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_plans_club_id_idx" ON "subscription_plans"("club_id");

-- CreateIndex
CREATE INDEX "subscriptions_club_id_user_id_idx" ON "subscriptions"("club_id", "user_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_source_subscription_id_fkey" FOREIGN KEY ("source_subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
