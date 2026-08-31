-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "openingCumulativeGross" DECIMAL(15,2),
ADD COLUMN     "openingCumulativeMonths" INTEGER;

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "payrollIndemnityDays" DECIMAL(5,2),
ADD COLUMN     "plannedPayrollMonth" INTEGER,
ADD COLUMN     "plannedPayrollYear" INTEGER;
