-- AlterTable
ALTER TABLE "advances" ADD COLUMN     "amountModifiedAt" TIMESTAMPTZ,
ADD COLUMN     "amountModifiedBy" UUID,
ADD COLUMN     "requestedAmount" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "amountModifiedAt" TIMESTAMPTZ,
ADD COLUMN     "amountModifiedBy" UUID,
ADD COLUMN     "requestedAmount" DECIMAL(15,2),
ADD COLUMN     "requestedMonthlyRepayment" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "debt_amendments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loanId" UUID,
    "advanceId" UUID,
    "oldAmount" DECIMAL(15,2),
    "newAmount" DECIMAL(15,2),
    "oldMonthlyRepayment" DECIMAL(15,2),
    "newMonthlyRepayment" DECIMAL(15,2),
    "oldDeductMonth" SMALLINT,
    "newDeductMonth" SMALLINT,
    "oldDeductYear" SMALLINT,
    "newDeductYear" SMALLINT,
    "modifiedBy" UUID,
    "modifiedByName" VARCHAR(200),
    "modifiedByRole" VARCHAR(30),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debt_amendments_loanId_idx" ON "debt_amendments"("loanId");

-- CreateIndex
CREATE INDEX "debt_amendments_advanceId_idx" ON "debt_amendments"("advanceId");

-- AddForeignKey
ALTER TABLE "debt_amendments" ADD CONSTRAINT "debt_amendments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_amendments" ADD CONSTRAINT "debt_amendments_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
