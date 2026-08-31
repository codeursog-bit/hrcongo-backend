-- AlterEnum
ALTER TYPE "company_deduction_status" ADD VALUE 'PAID';

-- AlterTable
ALTER TABLE "company_deductions" ADD COLUMN     "recoverViaPayroll" BOOLEAN NOT NULL DEFAULT true;
