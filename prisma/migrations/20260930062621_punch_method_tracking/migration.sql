-- CreateEnum
CREATE TYPE "punch_method" AS ENUM ('GPS', 'KIOSK', 'QR_SCAN', 'SECRET_CODE', 'MANUAL');

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "checkInMethod" "punch_method",
ADD COLUMN     "checkInSource" VARCHAR(100),
ADD COLUMN     "checkOutMethod" "punch_method",
ADD COLUMN     "checkOutSource" VARCHAR(100);
