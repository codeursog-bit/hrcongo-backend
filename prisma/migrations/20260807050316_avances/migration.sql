-- AlterTable
ALTER TABLE "advances" ADD COLUMN     "remainingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "advance_repayment_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advanceId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "payrollId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "advance_repayment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advance_repayment_logs_advanceId_idx" ON "advance_repayment_logs"("advanceId");

-- CreateIndex
CREATE INDEX "advance_repayment_logs_payrollId_idx" ON "advance_repayment_logs"("payrollId");

-- AddForeignKey
ALTER TABLE "advance_repayment_logs" ADD CONSTRAINT "advance_repayment_logs_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_repayment_logs" ADD CONSTRAINT "advance_repayment_logs_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
