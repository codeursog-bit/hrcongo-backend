-- CreateEnum
CREATE TYPE "GeneratedContractKind" AS ENUM ('CONTRAT_TRAVAIL', 'PRESTATION_SERVICES', 'CONSULTANT', 'STAGE');

-- CreateEnum
CREATE TYPE "GeneratedContractStatus" AS ENUM ('GENERE', 'ARCHIVE');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "contractRepresentativeName" VARCHAR(150),
ADD COLUMN     "contractRepresentativeRole" VARCHAR(150),
ADD COLUMN     "contractSignatureCity" VARCHAR(100),
ADD COLUMN     "contractTypesConfig" JSONB,
ADD COLUMN     "legalForm" VARCHAR(100);

-- CreateTable
CREATE TABLE "generated_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "GeneratedContractKind" NOT NULL,
    "contractDuration" VARCHAR(20) NOT NULL DEFAULT 'INDETERMINEE',
    "status" "GeneratedContractStatus" NOT NULL DEFAULT 'GENERE',
    "startDate" DATE,
    "endDate" DATE,
    "trialPeriodText" VARCHAR(100),
    "snapshot" JSONB NOT NULL,
    "baseSalary" DECIMAL(15,2) NOT NULL,
    "overSalary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overtimeFlat" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bonuses" JSONB NOT NULL DEFAULT '[]',
    "totalGross" DECIMAL(15,2) NOT NULL,
    "cnssDeduction" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "itsDeduction" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tolDeduction" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transportIndemnity" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "allowances" JSONB NOT NULL DEFAULT '[]',
    "netPay" DECIMAL(15,2) NOT NULL,
    "fileUrl" TEXT,
    "fileName" VARCHAR(255),
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "generated_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_contracts_companyId_idx" ON "generated_contracts"("companyId");

-- CreateIndex
CREATE INDEX "generated_contracts_employeeId_idx" ON "generated_contracts"("employeeId");

-- CreateIndex
CREATE INDEX "generated_contracts_status_idx" ON "generated_contracts"("status");

-- AddForeignKey
ALTER TABLE "generated_contracts" ADD CONSTRAINT "generated_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_contracts" ADD CONSTRAINT "generated_contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
