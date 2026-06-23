-- CreateTable
CREATE TABLE "player_rating_adjustments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "club_id" TEXT,
    "staff_user_id" TEXT NOT NULL,
    "previous_level" DOUBLE PRECISION,
    "new_level" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_rating_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_rating_adjustments_user_id_sport_id_idx" ON "player_rating_adjustments"("user_id", "sport_id");

-- AddForeignKey
ALTER TABLE "player_rating_adjustments" ADD CONSTRAINT "player_rating_adjustments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_rating_adjustments" ADD CONSTRAINT "player_rating_adjustments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_rating_adjustments" ADD CONSTRAINT "player_rating_adjustments_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_rating_adjustments" ADD CONSTRAINT "player_rating_adjustments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

