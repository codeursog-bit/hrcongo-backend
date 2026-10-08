-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "checkInGeo" JSONB,
ADD COLUMN     "checkOutGeo" JSONB;
