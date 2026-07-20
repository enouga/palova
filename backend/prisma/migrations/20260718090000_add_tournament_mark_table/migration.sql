CREATE TYPE "TournamentPresence" AS ENUM ('UNSEEN', 'PRESENT', 'ABSENT');
CREATE TYPE "BenchSource" AS ENUM ('FORFEIT', 'WALK_IN');

ALTER TABLE "tournament_registrations" ADD COLUMN "captain_presence" "TournamentPresence" NOT NULL DEFAULT 'UNSEEN';
ALTER TABLE "tournament_registrations" ADD COLUMN "partner_presence" "TournamentPresence" NOT NULL DEFAULT 'UNSEEN';

CREATE TABLE "tournament_bench_entries" (
  "id" TEXT NOT NULL,
  "tournament_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source" "BenchSource" NOT NULL,
  "added_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tournament_bench_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tournament_bench_entries_tournament_id_user_id_key" ON "tournament_bench_entries"("tournament_id", "user_id");
ALTER TABLE "tournament_bench_entries" ADD CONSTRAINT "tournament_bench_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_bench_entries" ADD CONSTRAINT "tournament_bench_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_bench_entries" ADD CONSTRAINT "tournament_bench_entries_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tournament_log_entries" (
  "id" TEXT NOT NULL,
  "tournament_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "kind" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tournament_log_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tournament_log_entries_tournament_id_created_at_idx" ON "tournament_log_entries"("tournament_id", "created_at");
ALTER TABLE "tournament_log_entries" ADD CONSTRAINT "tournament_log_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_log_entries" ADD CONSTRAINT "tournament_log_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
