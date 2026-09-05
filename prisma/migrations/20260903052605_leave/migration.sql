-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "leaveCycleMode" VARCHAR(20) NOT NULL DEFAULT 'ROLLING';

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "paidIndemnityAmount" DECIMAL(15,2);
