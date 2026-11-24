-- CreateEnum
CREATE TYPE "system_log_level" AS ENUM ('INFO', 'WARNING', 'ERROR', 'ALERT');

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "checkInDistance" INTEGER,
ADD COLUMN     "checkInSiteId" UUID,
ADD COLUMN     "checkInSiteName" VARCHAR(100),
ADD COLUMN     "checkOutDistance" INTEGER,
ADD COLUMN     "checkOutSiteId" UUID,
ADD COLUMN     "checkOutSiteName" VARCHAR(100);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" VARCHAR(100) NOT NULL,
    "level" "system_log_level" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "companyId" UUID,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_logs_source_idx" ON "system_logs"("source");

-- CreateIndex
CREATE INDEX "system_logs_level_idx" ON "system_logs"("level");

-- CreateIndex
CREATE INDEX "system_logs_companyId_idx" ON "system_logs"("companyId");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
