-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "leaveIndemnityMethod" VARCHAR(20) NOT NULL DEFAULT 'AVERAGE_12M',
ADD COLUMN     "leaveReferenceCycle" VARCHAR(20) NOT NULL DEFAULT 'JANUARY',
ADD COLUMN     "seniorityLinearConfig" JSONB;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "seniorityLinearOverride" JSONB;
