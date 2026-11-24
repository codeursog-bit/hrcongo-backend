-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "secondaryPhone" VARCHAR(20);

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "returnConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "returnConfirmedBy" UUID;
