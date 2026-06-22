-- AddColumn: sport optionnel sur ClubEvent (nullable, additif)
ALTER TABLE "club_events" ADD COLUMN "club_sport_id" TEXT;
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_club_sport_id_fkey"
  FOREIGN KEY ("club_sport_id") REFERENCES "club_sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
