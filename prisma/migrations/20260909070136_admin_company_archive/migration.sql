-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "archivedAt" TIMESTAMPTZ,
ADD COLUMN     "archivedByUserId" UUID,
ADD COLUMN     "archivedReason" TEXT;

-- CreateIndex
CREATE INDEX "companies_archivedAt_idx" ON "companies"("archivedAt");
