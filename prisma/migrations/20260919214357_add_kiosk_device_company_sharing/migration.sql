-- CreateTable
CREATE TABLE "KioskDeviceCompany" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deviceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "actingUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskDeviceCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskDeviceCompany_deviceId_idx" ON "KioskDeviceCompany"("deviceId");

-- CreateIndex
CREATE INDEX "KioskDeviceCompany_companyId_idx" ON "KioskDeviceCompany"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDeviceCompany_deviceId_companyId_key" ON "KioskDeviceCompany"("deviceId", "companyId");

-- AddForeignKey
ALTER TABLE "KioskDeviceCompany" ADD CONSTRAINT "KioskDeviceCompany_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDeviceCompany" ADD CONSTRAINT "KioskDeviceCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDeviceCompany" ADD CONSTRAINT "KioskDeviceCompany_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
