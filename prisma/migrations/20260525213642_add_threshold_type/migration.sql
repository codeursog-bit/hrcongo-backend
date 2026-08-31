-- CreateEnum
CREATE TYPE "CompanyTaxThreshold" AS ENUM ('ELIGIBILITY', 'EXCESS_ONLY');

-- AlterTable
ALTER TABLE "company_taxes" ADD COLUMN     "thresholdType" "CompanyTaxThreshold" NOT NULL DEFAULT 'ELIGIBILITY';
