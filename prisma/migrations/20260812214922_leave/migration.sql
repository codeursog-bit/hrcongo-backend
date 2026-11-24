-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "actualReturnDate" DATE,
ADD COLUMN     "debitedCycleStartDate" DATE,
ADD COLUMN     "forfeitedDays" DECIMAL(5,2),
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false;
