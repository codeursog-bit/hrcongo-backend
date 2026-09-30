-- CreateEnum
CREATE TYPE "display_screen_status" AS ENUM ('PENDING', 'APPROVED', 'REVOKED');

-- CreateEnum
CREATE TYPE "display_screen_scope" AS ENUM ('COMPANY', 'PORTFOLIO');

-- AlterTable
ALTER TABLE "absence_requests" ADD COLUMN     "coveredDays" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "display_screens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100),
    "status" "display_screen_status" NOT NULL DEFAULT 'PENDING',
    "scope" "display_screen_scope",
    "pairingCode" VARCHAR(8),
    "pairingExpiresAt" TIMESTAMPTZ,
    "pollTokenHash" VARCHAR(64),
    "deviceTokenHash" VARCHAR(64),
    "tokenDeliveredAt" TIMESTAMPTZ,
    "qrSalt" VARCHAR(64) NOT NULL,
    "companyId" UUID,
    "ownerUserId" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "lastSeenAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "display_screens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_secrets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "secretLookup" VARCHAR(64) NOT NULL,
    "setByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "employee_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "display_screens_pairingCode_key" ON "display_screens"("pairingCode");

-- CreateIndex
CREATE UNIQUE INDEX "display_screens_pollTokenHash_key" ON "display_screens"("pollTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "display_screens_deviceTokenHash_key" ON "display_screens"("deviceTokenHash");

-- CreateIndex
CREATE INDEX "display_screens_companyId_idx" ON "display_screens"("companyId");

-- CreateIndex
CREATE INDEX "display_screens_ownerUserId_idx" ON "display_screens"("ownerUserId");

-- CreateIndex
CREATE INDEX "display_screens_status_idx" ON "display_screens"("status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_secrets_employeeId_key" ON "employee_secrets"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_secrets_secretLookup_key" ON "employee_secrets"("secretLookup");

-- CreateIndex
CREATE INDEX "employee_secrets_companyId_idx" ON "employee_secrets"("companyId");

-- AddForeignKey
ALTER TABLE "display_screens" ADD CONSTRAINT "display_screens_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "display_screens" ADD CONSTRAINT "display_screens_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "display_screens" ADD CONSTRAINT "display_screens_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_secrets" ADD CONSTRAINT "employee_secrets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_secrets" ADD CONSTRAINT "employee_secrets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
