-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "gpsToleranceMeters" SMALLINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "company_trusted_ips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "ip" VARCHAR(64) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_trusted_ips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_trusted_ips_companyId_idx" ON "company_trusted_ips"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_trusted_ips_companyId_ip_key" ON "company_trusted_ips"("companyId", "ip");

-- AddForeignKey
ALTER TABLE "company_trusted_ips" ADD CONSTRAINT "company_trusted_ips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
