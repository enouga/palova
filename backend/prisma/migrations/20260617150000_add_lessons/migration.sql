-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "lesson_kind" "LessonKind" NOT NULL,
    "allow_self_enroll" BOOLEAN NOT NULL DEFAULT false,
    "series_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_enrollments" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT,
    "series_id" TEXT,
    "user_id" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lesson_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lessons_reservation_id_key" ON "lessons"("reservation_id");
CREATE INDEX "lessons_club_id_idx" ON "lessons"("club_id");
CREATE INDEX "lessons_series_id_idx" ON "lessons"("series_id");
CREATE UNIQUE INDEX "lesson_enrollments_lesson_id_user_id_key" ON "lesson_enrollments"("lesson_id", "user_id");
CREATE UNIQUE INDEX "lesson_enrollments_series_id_user_id_key" ON "lesson_enrollments"("series_id", "user_id");
CREATE INDEX "lesson_enrollments_lesson_id_status_created_at_idx" ON "lesson_enrollments"("lesson_id", "status", "created_at");
CREATE INDEX "lesson_enrollments_series_id_status_created_at_idx" ON "lesson_enrollments"("series_id", "status", "created_at");
CREATE INDEX "lesson_enrollments_user_id_idx" ON "lesson_enrollments"("user_id");

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "reservation_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_enrollments" ADD CONSTRAINT "lesson_enrollments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_enrollments" ADD CONSTRAINT "lesson_enrollments_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "reservation_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_enrollments" ADD CONSTRAINT "lesson_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
