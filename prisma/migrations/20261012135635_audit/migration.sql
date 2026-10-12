/*
  Warnings:

  - A unique constraint covering the columns `[previousContractId]` on the table `employee_contracts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[chainId,rank]` on the table `employee_contracts` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "contract_link_kind" AS ENUM ('INITIAL', 'RENEWAL', 'CONVERSION_CDI');

-- CreateEnum
CREATE TYPE "audit_severity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "audit_finding_status" AS ENUM ('OPEN', 'JUSTIFIED', 'WAIVED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "audit_run_trigger" AS ENUM ('MANUAL', 'GATE', 'CRON');

-- CreateEnum
CREATE TYPE "audit_checkpoint_status" AS ENUM ('DONE', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "employee_contracts" ADD COLUMN     "cddMotif" VARCHAR(40),
ADD COLUMN     "chainId" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "kind" "contract_link_kind" NOT NULL DEFAULT 'INITIAL',
ADD COLUMN     "previousContractId" UUID,
ADD COLUMN     "rank" SMALLINT NOT NULL DEFAULT 1,
ADD COLUMN     "renewalReason" VARCHAR(255),
ADD COLUMN     "renewedAt" TIMESTAMPTZ,
ADD COLUMN     "renewedBy" UUID;

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "actorType" "audit_actor_type" NOT NULL DEFAULT 'USER',
    "actorId" UUID,
    "actorRole" VARCHAR(30),
    "actorLabel" VARCHAR(200),
    "action" VARCHAR(80) NOT NULL,
    "entity" VARCHAR(50) NOT NULL,
    "entityId" UUID,
    "severity" "audit_severity" NOT NULL DEFAULT 'INFO',
    "summary" VARCHAR(500) NOT NULL,
    "changes" JSONB,
    "context" JSONB,
    "prevHash" CHAR(64),
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "trigger" "audit_run_trigger" NOT NULL,
    "startedBy" UUID,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "finishedAt" TIMESTAMPTZ NOT NULL,
    "payrollsChecked" INTEGER NOT NULL,
    "payrollsWithFindings" INTEGER NOT NULL DEFAULT 0,
    "rulesRun" INTEGER NOT NULL,
    "findingsNew" INTEGER NOT NULL,
    "findingsResolved" INTEGER NOT NULL,
    "findingsOpen" INTEGER NOT NULL,
    "openCritical" INTEGER NOT NULL,
    "openBlocking" INTEGER NOT NULL,

    CONSTRAINT "audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "runId" UUID,
    "fingerprint" VARCHAR(200) NOT NULL,
    "ruleCode" VARCHAR(60) NOT NULL,
    "severity" "audit_severity" NOT NULL,
    "blocking" BOOLEAN NOT NULL,
    "status" "audit_finding_status" NOT NULL DEFAULT 'OPEN',
    "entity" VARCHAR(50) NOT NULL,
    "entityId" UUID,
    "employeeId" UUID,
    "periodMonth" SMALLINT,
    "periodYear" SMALLINT,
    "message" VARCHAR(500) NOT NULL,
    "expected" VARCHAR(200),
    "actual" VARCHAR(200),
    "resolutionNote" VARCHAR(500),
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMPTZ,
    "firstDetectedAt" TIMESTAMPTZ NOT NULL,
    "lastDetectedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "audit_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "periodMonth" SMALLINT NOT NULL,
    "periodYear" SMALLINT NOT NULL,
    "status" "audit_checkpoint_status" NOT NULL,
    "evidenceRef" VARCHAR(200),
    "note" VARCHAR(500),
    "attestedBy" UUID NOT NULL,
    "attestedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "audit_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_companyId_occurredAt_idx" ON "audit_events"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_companyId_entity_entityId_idx" ON "audit_events"("companyId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_companyId_action_idx" ON "audit_events"("companyId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_companyId_seq_key" ON "audit_events"("companyId", "seq");

-- CreateIndex
CREATE INDEX "audit_runs_companyId_year_month_startedAt_idx" ON "audit_runs"("companyId", "year", "month", "startedAt");

-- CreateIndex
CREATE INDEX "audit_findings_companyId_status_blocking_idx" ON "audit_findings"("companyId", "status", "blocking");

-- CreateIndex
CREATE INDEX "audit_findings_companyId_periodYear_periodMonth_idx" ON "audit_findings"("companyId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "audit_findings_employeeId_idx" ON "audit_findings"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_findings_companyId_fingerprint_key" ON "audit_findings"("companyId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "audit_checkpoints_companyId_code_periodYear_periodMonth_key" ON "audit_checkpoints"("companyId", "code", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "employee_contracts_previousContractId_key" ON "employee_contracts"("previousContractId");

-- CreateIndex
CREATE INDEX "employee_contracts_chainId_idx" ON "employee_contracts"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_contracts_chainId_rank_key" ON "employee_contracts"("chainId", "rank");

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_previousContractId_fkey" FOREIGN KEY ("previousContractId") REFERENCES "employee_contracts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_checkpoints" ADD CONSTRAINT "audit_checkpoints_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
