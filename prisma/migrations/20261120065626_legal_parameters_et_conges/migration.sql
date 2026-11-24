-- DropForeignKey
ALTER TABLE "subscription_usage" DROP CONSTRAINT "subscription_usage_companyId_fkey";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "leavePostponedPayMode" VARCHAR(30) NOT NULL DEFAULT 'KEEP_INITIAL';

-- AlterTable
ALTER TABLE "subscription_usage" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "legal_parameter_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "effectiveFrom" DATE NOT NULL,
    "params" JSONB NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdByName" VARCHAR(200),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_parameter_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_parameter_versions_effectiveFrom_idx" ON "legal_parameter_versions"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "subscription_usage" ADD CONSTRAINT "subscription_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "subscriptions"("companyId") ON DELETE CASCADE ON UPDATE CASCADE;
