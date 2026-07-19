-- CreateTable
CREATE TABLE "club_event_series" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ClubEventKind" NOT NULL,
    "description" TEXT,
    "capacity" INTEGER,
    "price" DECIMAL(10,2),
    "member_only" BOOLEAN NOT NULL DEFAULT true,
    "require_prepayment" BOOLEAN NOT NULL DEFAULT false,
    "club_sport_id" TEXT,
    "weekday" INTEGER NOT NULL,
    "start_local" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "deadline_lead_minutes" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_event_series_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "club_events" ADD COLUMN "series_id" TEXT;

-- CreateIndex
CREATE INDEX "club_event_series_club_id_idx" ON "club_event_series"("club_id");

-- CreateIndex
CREATE INDEX "club_events_series_id_idx" ON "club_events"("series_id");

-- AddForeignKey
ALTER TABLE "club_event_series" ADD CONSTRAINT "club_event_series_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "club_event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
