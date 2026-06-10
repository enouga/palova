-- CreateEnum
CREATE TYPE "PackageKind" AS ENUM ('ENTRIES', 'WALLET');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('PENDING_REIMBURSEMENT', 'REIMBURSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'VOUCHER';
ALTER TYPE "PaymentMethod" ADD VALUE 'PACK_CREDIT';
ALTER TYPE "PaymentMethod" ADD VALUE 'WALLET';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "club_id" TEXT,
ADD COLUMN     "member_package_id" TEXT,
ADD COLUMN     "source_package_id" TEXT,
ADD COLUMN     "voucher_issuer" TEXT,
ADD COLUMN     "voucher_ref" TEXT,
ADD COLUMN     "voucher_status" "VoucherStatus",
ALTER COLUMN "reservation_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "package_templates" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "kind" "PackageKind" NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "entries_count" INTEGER,
    "wallet_amount" DECIMAL(10,2),
    "validity_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_packages" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "kind" "PackageKind" NOT NULL,
    "credits_total" INTEGER,
    "credits_remaining" INTEGER,
    "amount_total" DECIMAL(10,2),
    "amount_remaining" DECIMAL(10,2),
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "member_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_templates_club_id_idx" ON "package_templates"("club_id");

-- CreateIndex
CREATE INDEX "member_packages_club_id_user_id_idx" ON "member_packages"("club_id", "user_id");

-- CreateIndex
CREATE INDEX "payments_club_id_created_at_idx" ON "payments"("club_id", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_package_id_fkey" FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_source_package_id_fkey" FOREIGN KEY ("source_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_templates" ADD CONSTRAINT "package_templates_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_packages" ADD CONSTRAINT "member_packages_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_packages" ADD CONSTRAINT "member_packages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_packages" ADD CONSTRAINT "member_packages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "package_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill du club des paiements existants (via réservation → ressource).
UPDATE "payments" p
SET "club_id" = res."club_id"
FROM "reservations" r
JOIN "resources" res ON res."id" = r."resource_id"
WHERE p."reservation_id" = r."id" AND p."club_id" IS NULL;
