-- CreateEnum
CREATE TYPE "CheckinCredentialType" AS ENUM ('NFC_BADGE', 'QR_CODE');

-- CreateTable
CREATE TABLE "CheckinCredential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "CheckinCredentialType" NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,

    CONSTRAINT "CheckinCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "apiKey" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" UUID NOT NULL,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckinCredential_identifier_key" ON "CheckinCredential"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_apiKey_key" ON "KioskDevice"("apiKey");

-- AddForeignKey
ALTER TABLE "CheckinCredential" ADD CONSTRAINT "CheckinCredential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinCredential" ADD CONSTRAINT "CheckinCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
