-- Tournoi "Messieurs" ouvert aux femmes (tableau "open" : toute composition d'équipe acceptée).
-- Additif et rétrocompatible : défaut true (convention FFT). N'a de sens que pour gender = MEN.
ALTER TABLE "tournaments" ADD COLUMN "open_to_women" BOOLEAN NOT NULL DEFAULT true;
