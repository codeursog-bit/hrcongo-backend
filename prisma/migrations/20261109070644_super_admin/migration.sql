-- DropForeignKey
ALTER TABLE "compta_connectors" DROP CONSTRAINT "compta_connectors_companyId_fkey";

-- DropForeignKey
ALTER TABLE "compta_deliveries" DROP CONSTRAINT "compta_deliveries_connectorId_fkey";

-- DropForeignKey
ALTER TABLE "compta_deliveries" DROP CONSTRAINT "compta_deliveries_payrollId_fkey";

-- DropForeignKey
ALTER TABLE "compta_receipts" DROP CONSTRAINT "compta_receipts_connectorId_fkey";

-- AlterTable
ALTER TABLE "custom_quotes" ADD COLUMN     "coversPortfolio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portfolioOwnerId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "activatedCompanyIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "coveredCompanyIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateIndex
CREATE INDEX "custom_quotes_portfolioOwnerId_idx" ON "custom_quotes"("portfolioOwnerId");

-- CreateIndex
CREATE INDEX "payments_coveredCompanyIds_idx" ON "payments" USING GIN ("coveredCompanyIds");

-- AddForeignKey
ALTER TABLE "compta_connectors" ADD CONSTRAINT "compta_connectors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compta_deliveries" ADD CONSTRAINT "compta_deliveries_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "compta_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compta_deliveries" ADD CONSTRAINT "compta_deliveries_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compta_receipts" ADD CONSTRAINT "compta_receipts_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "compta_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
