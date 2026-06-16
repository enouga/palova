-- CreateTable
CREATE TABLE "player_ratings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "display_level" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "last_match_at" TIMESTAMP(3),
    "is_provisional" BOOLEAN NOT NULL DEFAULT true,
    "initial_self_level" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_ratings_sport_id_display_level_idx" ON "player_ratings"("sport_id", "display_level");

-- CreateIndex
CREATE UNIQUE INDEX "player_ratings_user_id_sport_id_key" ON "player_ratings"("user_id", "sport_id");

-- AddForeignKey
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
