/*
  Warnings:

  - Added the required column `remainingBalance` to the `company_deductions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "company_deductions" ADD COLUMN     "monthlyDeduction" DECIMAL(15,2),
ADD COLUMN     "remainingBalance" DECIMAL(15,2) NOT NULL;

-- CreateTable
CREATE TABLE "company_deduction_repayment_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyDeductionId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "repayment_method" NOT NULL,
    "recordedBy" UUID,
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_deduction_repayment_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "company_deduction_repayment_logs" ADD CONSTRAINT "company_deduction_repayment_logs_companyDeductionId_fkey" FOREIGN KEY ("companyDeductionId") REFERENCES "company_deductions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
