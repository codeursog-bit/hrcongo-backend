-- AlterTable
ALTER TABLE "AssistantSettings" ADD COLUMN     "creditsPerAnalysis" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "creditsPerMessage" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "trialCredits" INTEGER NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "AssistantCreditWallet" (
    "companyId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "trialGrantedAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AssistantCreditWallet_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "AssistantCreditLedger" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" VARCHAR(12) NOT NULL,
    "note" VARCHAR(200),
    "refId" VARCHAR(64),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantCreditPack" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'XAF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AssistantCreditPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantCreditLedger_companyId_createdAt_idx" ON "AssistantCreditLedger"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCreditLedger_companyId_reason_refId_key" ON "AssistantCreditLedger"("companyId", "reason", "refId");

-- AddForeignKey
ALTER TABLE "AssistantCreditWallet" ADD CONSTRAINT "AssistantCreditWallet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCreditLedger" ADD CONSTRAINT "AssistantCreditLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
