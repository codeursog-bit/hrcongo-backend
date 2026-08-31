-- DropIndex
DROP INDEX "loan_repayment_logs_loanId_month_year_key";

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "decidedByRole" VARCHAR(10);
