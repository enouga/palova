-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "department" TEXT,
ADD COLUMN     "department_code" TEXT,
ADD COLUMN     "list_tournaments_nationally" BOOLEAN NOT NULL DEFAULT false;
