-- AlterTable : politique opt-in de remboursement auto à l'annulation (additif, défaut false).
ALTER TABLE "clubs" ADD COLUMN "refund_on_cancel_within_cutoff" BOOLEAN NOT NULL DEFAULT false;
