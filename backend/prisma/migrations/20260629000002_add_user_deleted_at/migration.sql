-- Marqueur d'anonymisation (soft delete). Login refusé si non null.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
