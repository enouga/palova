-- Description complète des offres prépayées (affichée aux joueurs sur le club-house).
ALTER TABLE "package_templates" ADD COLUMN "description" TEXT;
ALTER TABLE "subscription_plans" ADD COLUMN "description" TEXT;
