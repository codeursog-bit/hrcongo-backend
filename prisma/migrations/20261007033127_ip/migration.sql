-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "gpsToleranceMeters" SET DEFAULT 30;

-- CreateTable
CREATE TABLE "company_ip_sightings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ip" VARCHAR(64) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "company_ip_sightings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_ip_sightings_companyId_ip_lastSeenAt_idx" ON "company_ip_sightings"("companyId", "ip", "lastSeenAt");

-- CreateIndex
CREATE INDEX "company_ip_sightings_lastSeenAt_idx" ON "company_ip_sightings"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "company_ip_sightings_companyId_ip_userId_key" ON "company_ip_sightings"("companyId", "ip", "userId");

-- AddForeignKey
ALTER TABLE "company_ip_sightings" ADD CONSTRAINT "company_ip_sightings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
