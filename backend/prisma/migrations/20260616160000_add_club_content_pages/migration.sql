-- CreateEnum
CREATE TYPE "ClubPageKind" AS ENUM ('CGV', 'MENTIONS_LEGALES', 'CONFIDENTIALITE', 'OFFRES');

-- CreateEnum
CREATE TYPE "ClubPageSource" AS ENUM ('TEMPLATE', 'CUSTOM');

-- AlterTable
ALTER TABLE "clubs" ADD COLUMN "legal_entity_name" TEXT,
ADD COLUMN "legal_form" TEXT,
ADD COLUMN "siret" TEXT,
ADD COLUMN "vat_number" TEXT,
ADD COLUMN "legal_representative" TEXT,
ADD COLUMN "legal_email" TEXT,
ADD COLUMN "legal_phone" TEXT;

-- CreateTable
CREATE TABLE "club_pages" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "kind" "ClubPageKind" NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "source" "ClubPageSource" NOT NULL DEFAULT 'CUSTOM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_faq_items" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer_markdown" TEXT NOT NULL,
    "category" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_pages_club_id_idx" ON "club_pages"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_pages_club_id_kind_key" ON "club_pages"("club_id", "kind");

-- CreateIndex
CREATE INDEX "club_faq_items_club_id_idx" ON "club_faq_items"("club_id");

-- AddForeignKey
ALTER TABLE "club_pages" ADD CONSTRAINT "club_pages_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_faq_items" ADD CONSTRAINT "club_faq_items_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
