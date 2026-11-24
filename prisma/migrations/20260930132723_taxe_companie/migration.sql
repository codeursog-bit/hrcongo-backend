-- AlterTable
ALTER TABLE "company_taxes" ADD COLUMN     "applicableContractTypes" "contract_type"[] DEFAULT ARRAY['CDI', 'CDD']::"contract_type"[],
ADD COLUMN     "applicableMonth" SMALLINT,
ADD COLUMN     "applicableYear" SMALLINT,
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT true;
