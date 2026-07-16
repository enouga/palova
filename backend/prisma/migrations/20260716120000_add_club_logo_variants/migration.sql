-- Logos multi-formats : logoUrl reste l'icône carrée, on ajoute les logotypes horizontaux.
ALTER TABLE "clubs" ADD COLUMN "logo_wide_url" TEXT;
ALTER TABLE "clubs" ADD COLUMN "logo_wide_dark_url" TEXT;
