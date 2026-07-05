-- Affiche des offres prépayées / abonnements (uploadée avec la description).
ALTER TABLE "package_templates" ADD COLUMN "image_url" TEXT;
ALTER TABLE "subscription_plans" ADD COLUMN "image_url" TEXT;
