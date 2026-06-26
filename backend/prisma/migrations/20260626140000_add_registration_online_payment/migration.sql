-- CreateEnum
CREATE TYPE "RegistrationPaymentStatus" AS ENUM ('NONE', 'DUE', 'PAID', 'REFUNDED');

-- AlterTable
ALTER TABLE "club_events" ADD COLUMN     "require_prepayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "event_registrations" ADD COLUMN     "payment_deadline" TIMESTAMPTZ,
ADD COLUMN     "payment_status" "RegistrationPaymentStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "event_registration_id" TEXT,
ADD COLUMN     "tournament_registration_id" TEXT;

-- AlterTable
ALTER TABLE "tournament_registrations" ADD COLUMN     "payment_deadline" TIMESTAMPTZ,
ADD COLUMN     "payment_status" "RegistrationPaymentStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "require_prepayment" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "payments_tournament_registration_id_idx" ON "payments"("tournament_registration_id");

-- CreateIndex
CREATE INDEX "payments_event_registration_id_idx" ON "payments"("event_registration_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tournament_registration_id_fkey" FOREIGN KEY ("tournament_registration_id") REFERENCES "tournament_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_event_registration_id_fkey" FOREIGN KEY ("event_registration_id") REFERENCES "event_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
