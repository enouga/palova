-- Genre des parties ouvertes (Féminine / Mixte). Additif, null = ouverte à tous.
CREATE TYPE "OpenMatchGender" AS ENUM ('WOMEN', 'MIXED');
ALTER TABLE "reservations" ADD COLUMN "match_gender" "OpenMatchGender";
