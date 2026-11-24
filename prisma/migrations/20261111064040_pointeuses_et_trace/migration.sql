-- CreateEnum
CREATE TYPE "sync_connector_kind" AS ENUM ('ZKTECO_NETWORK', 'FILE_IMPORT', 'HTTP_API', 'CUSTOM');

-- CreateEnum
CREATE TYPE "sync_job_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sync_job_trigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "device_punch_status" AS ENUM ('PENDING', 'USED', 'UNMAPPED', 'INCOMPLETE', 'CONFLICT', 'IGNORED');

-- AlterEnum
ALTER TYPE "punch_method" ADD VALUE 'DEVICE';

-- AlterTable
ALTER TABLE "attendance_logs" ADD COLUMN     "action" VARCHAR(30),
ADD COLUMN     "actorRole" VARCHAR(30);

-- CreateTable
CREATE TABLE "sync_connectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "sync_connector_kind" NOT NULL,
    "config" JSONB,
    "agentKeyHash" VARCHAR(64) NOT NULL,
    "agentKeyHint" VARCHAR(8) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMPTZ,
    "lastAgentVersion" VARCHAR(30),
    "lastSyncAt" TIMESTAMPTZ,
    "lastPunchAt" TIMESTAMPTZ,
    "actingUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connectorId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "status" "sync_job_status" NOT NULL DEFAULT 'PENDING',
    "trigger" "sync_job_trigger" NOT NULL DEFAULT 'MANUAL',
    "rangeFrom" VARCHAR(10),
    "rangeTo" VARCHAR(10),
    "requestedById" UUID,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ,
    "lastProgressAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_punches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connectorId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "jobId" UUID,
    "deviceUserId" VARCHAR(100) NOT NULL,
    "punchedAt" TIMESTAMPTZ NOT NULL,
    "rawState" SMALLINT,
    "rawPayload" JSONB,
    "employeeId" UUID,
    "date" VARCHAR(10),
    "status" "device_punch_status" NOT NULL DEFAULT 'PENDING',
    "statusNote" VARCHAR(200),
    "processedAt" TIMESTAMPTZ,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_employee_maps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connectorId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "deviceUserId" VARCHAR(100) NOT NULL,
    "deviceUserName" VARCHAR(150),
    "employeeId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_employee_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_connectors_agentKeyHash_key" ON "sync_connectors"("agentKeyHash");

-- CreateIndex
CREATE INDEX "sync_connectors_companyId_idx" ON "sync_connectors"("companyId");

-- CreateIndex
CREATE INDEX "sync_jobs_connectorId_requestedAt_idx" ON "sync_jobs"("connectorId", "requestedAt");

-- CreateIndex
CREATE INDEX "sync_jobs_companyId_status_idx" ON "sync_jobs"("companyId", "status");

-- CreateIndex
CREATE INDEX "device_punches_companyId_status_idx" ON "device_punches"("companyId", "status");

-- CreateIndex
CREATE INDEX "device_punches_companyId_employeeId_date_idx" ON "device_punches"("companyId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "device_punches_connectorId_deviceUserId_punchedAt_key" ON "device_punches"("connectorId", "deviceUserId", "punchedAt");

-- CreateIndex
CREATE INDEX "device_employee_maps_companyId_employeeId_idx" ON "device_employee_maps"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "device_employee_maps_connectorId_deviceUserId_key" ON "device_employee_maps"("connectorId", "deviceUserId");

-- AddForeignKey
ALTER TABLE "sync_connectors" ADD CONSTRAINT "sync_connectors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "sync_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_punches" ADD CONSTRAINT "device_punches_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "sync_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_punches" ADD CONSTRAINT "device_punches_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "sync_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_employee_maps" ADD CONSTRAINT "device_employee_maps_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "sync_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_employee_maps" ADD CONSTRAINT "device_employee_maps_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
