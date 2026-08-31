/*
  Warnings:

  - Added the required column `month` to the `advance_repayment_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `year` to the `advance_repayment_logs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "advance_repayment_logs" ADD COLUMN     "method" "repayment_method" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "month" SMALLINT NOT NULL,
ADD COLUMN     "recordedBy" UUID,
ADD COLUMN     "year" SMALLINT NOT NULL;
