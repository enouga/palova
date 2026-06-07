-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "peak_hours" JSONB;

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "off_peak_price_per_hour" DECIMAL(10,2);
