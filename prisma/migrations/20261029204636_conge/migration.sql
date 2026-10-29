-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "nextDepartureDate" DATE,
ADD COLUMN     "remainderBaseDays" DECIMAL(5,2),
ADD COLUMN     "remainderSeniorityDays" DECIMAL(5,2);
