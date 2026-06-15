-- AlterTable : numéro de reçu (séquentiel par club, nullable pour l'historique)
ALTER TABLE "payments" ADD COLUMN "receipt_no" INTEGER;

-- CreateTable : compteurs séquentiels par club
CREATE TABLE "club_counters" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "club_counters_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE UNIQUE INDEX "payments_club_id_receipt_no_key" ON "payments"("club_id", "receipt_no");
CREATE UNIQUE INDEX "club_counters_club_id_kind_key" ON "club_counters"("club_id", "kind");

-- FK
ALTER TABLE "club_counters" ADD CONSTRAINT "club_counters_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
