-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "ytdCarryOverBrut" DECIMAL(15,2),
ADD COLUMN     "ytdCarryOverChargesPat" DECIMAL(15,2),
ADD COLUMN     "ytdCarryOverChargesSal" DECIMAL(15,2),
ADD COLUMN     "ytdCarryOverDate" DATE;
