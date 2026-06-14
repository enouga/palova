-- CreateEnum
CREATE TYPE "ReservationVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "participant_id" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "visibility" "ReservationVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "reservation_participants" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "is_organizer" BOOLEAN NOT NULL DEFAULT false,
    "share" DECIMAL(10,2) NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_participants_user_id_idx" ON "reservation_participants"("user_id");

-- CreateIndex
CREATE INDEX "reservation_participants_reservation_id_idx" ON "reservation_participants"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_participants_reservation_id_user_id_key" ON "reservation_participants"("reservation_id", "user_id");

-- CreateIndex
CREATE INDEX "payments_participant_id_idx" ON "payments"("participant_id");

-- CreateIndex
CREATE INDEX "reservations_visibility_status_start_time_idx" ON "reservations"("visibility", "status", "start_time");

-- AddForeignKey
ALTER TABLE "reservation_participants" ADD CONSTRAINT "reservation_participants_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_participants" ADD CONSTRAINT "reservation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "reservation_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
