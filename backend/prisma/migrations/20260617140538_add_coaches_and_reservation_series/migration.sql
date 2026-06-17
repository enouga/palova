-- CreateEnum
CREATE TYPE "LessonKind" AS ENUM ('INDIVIDUAL', 'COLLECTIVE');

-- CreateEnum
CREATE TYPE "EnrollmentMode" AS ENUM ('SERIES', 'PER_SESSION');

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "series_id" TEXT;

-- CreateTable
CREATE TABLE "coaches" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photo_url" TEXT,
    "bio" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_series" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "type" "ReservationType" NOT NULL DEFAULT 'COURT',
    "title" TEXT,
    "weekday" INTEGER NOT NULL,
    "start_local" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "coach_id" TEXT,
    "capacity" INTEGER,
    "lesson_kind" "LessonKind",
    "allow_self_enroll" BOOLEAN NOT NULL DEFAULT false,
    "enrollment_mode" "EnrollmentMode",
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coaches_club_id_idx" ON "coaches"("club_id");

-- CreateIndex
CREATE INDEX "reservation_series_club_id_idx" ON "reservation_series"("club_id");

-- CreateIndex
CREATE INDEX "reservation_series_resource_id_idx" ON "reservation_series"("resource_id");

-- CreateIndex
CREATE INDEX "reservation_series_coach_id_idx" ON "reservation_series"("coach_id");

-- CreateIndex
CREATE INDEX "reservations_series_id_idx" ON "reservations"("series_id");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "reservation_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaches" ADD CONSTRAINT "coaches_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_series" ADD CONSTRAINT "reservation_series_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_series" ADD CONSTRAINT "reservation_series_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_series" ADD CONSTRAINT "reservation_series_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
