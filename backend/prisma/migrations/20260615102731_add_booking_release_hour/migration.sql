-- CreateEnum
CREATE TYPE "BookingReleaseMode" AS ENUM ('DAY_AT_HOUR', 'ROLLING_SLOT', 'WINDOW_SHIFT');

-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "booking_release_mode" "BookingReleaseMode" NOT NULL DEFAULT 'DAY_AT_HOUR',
ADD COLUMN     "member_release_hour" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "public_release_hour" INTEGER NOT NULL DEFAULT 0;
