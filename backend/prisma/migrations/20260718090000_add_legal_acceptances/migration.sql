-- Preuves d'acceptation des documents legaux plateforme (spec 2026-07-17-conformite-legale).
-- Insert-only : une ligne = qui a accepte quoi, quelle version, quand, dans quel contexte.
CREATE TYPE "LegalDocument" AS ENUM ('CGU', 'CGV_SAAS', 'PRIVACY');
CREATE TABLE IF NOT EXISTS "legal_acceptances" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "club_id" TEXT,
  "document" "LegalDocument" NOT NULL,
  "version" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "legal_acceptances_user_id_document_idx"
  ON "legal_acceptances"("user_id", "document");
