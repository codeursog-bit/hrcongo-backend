BEGIN;
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "assistantAnalysesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AssistantSettings" ADD COLUMN     "analysisEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "killSwitch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "planLimits" JSONB NOT NULL DEFAULT '{"TRIAL":{"maxMode":"INTEGRE","monthlyAnalyses":20},"FREE":{"maxMode":"INTEGRE","monthlyAnalyses":3},"BASIC":{"maxMode":"INTEGRE","monthlyAnalyses":30},"PRO":{"maxMode":"INTEGRE","monthlyAnalyses":150},"ENTERPRISE":{"maxMode":"INTEGRE","monthlyAnalyses":1000}}';

-- AlterTable
ALTER TABLE "AssistantCompanyOverride" ADD COLUMN     "forceMode" VARCHAR(15);

-- CreateTable
CREATE TABLE "AssistantAnalysisUsage" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID,
    "requestId" UUID NOT NULL,
    "cacheKey" VARCHAR(64) NOT NULL,
    "tool" VARCHAR(40) NOT NULL,
    "charged" BOOLEAN NOT NULL DEFAULT true,
    "periodStart" TIMESTAMPTZ NOT NULL,
    "periodEnd" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAnalysisUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantAnalysisUsage_companyId_periodStart_charged_idx" ON "AssistantAnalysisUsage"("companyId", "periodStart", "charged");

-- CreateIndex
CREATE INDEX "AssistantAnalysisUsage_companyId_cacheKey_createdAt_idx" ON "AssistantAnalysisUsage"("companyId", "cacheKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantAnalysisUsage_companyId_requestId_key" ON "AssistantAnalysisUsage"("companyId", "requestId");

-- AddForeignKey
ALTER TABLE "AssistantAnalysisUsage" ADD CONSTRAINT "AssistantAnalysisUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAnalysisUsage" ADD CONSTRAINT "AssistantAnalysisUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
