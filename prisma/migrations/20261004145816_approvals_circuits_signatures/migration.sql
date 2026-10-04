-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'OPINION_REQUEST';
ALTER TYPE "notification_type" ADD VALUE 'OPINION_GIVEN';
ALTER TYPE "notification_type" ADD VALUE 'DECISION_NEEDS_CONFIRMATION';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "signatureUrl" VARCHAR(500);

-- CreateTable
CREATE TABLE "user_approval_functions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "canSign" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_approval_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_circuits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "requestType" VARCHAR(20) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "approval_circuits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_circuit_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "circuitId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "functionCode" VARCHAR(40) NOT NULL,

    CONSTRAINT "approval_circuit_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_opinions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "requestType" VARCHAR(20) NOT NULL,
    "requestId" UUID NOT NULL,
    "functionCode" VARCHAR(40) NOT NULL,
    "userId" UUID,
    "authorName" VARCHAR(200) NOT NULL,
    "opinion" VARCHAR(15) NOT NULL,
    "comment" TEXT,
    "signatureUrl" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "approval_opinions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_pending_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "requestType" VARCHAR(20) NOT NULL,
    "requestId" UUID NOT NULL,
    "decision" VARCHAR(10) NOT NULL,
    "state" VARCHAR(25) NOT NULL,
    "decidedByUserId" UUID,
    "decidedByName" VARCHAR(200) NOT NULL,
    "payload" JSONB,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "missingAtDecision" JSONB,
    "finalizedByUserId" UUID,
    "finalizedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "approval_pending_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_approval_functions_companyId_code_idx" ON "user_approval_functions"("companyId", "code");

-- CreateIndex
CREATE INDEX "user_approval_functions_userId_idx" ON "user_approval_functions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_approval_functions_userId_companyId_code_key" ON "user_approval_functions"("userId", "companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "approval_circuits_companyId_requestType_key" ON "approval_circuits"("companyId", "requestType");

-- CreateIndex
CREATE INDEX "approval_circuit_steps_circuitId_position_idx" ON "approval_circuit_steps"("circuitId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "approval_circuit_steps_circuitId_functionCode_key" ON "approval_circuit_steps"("circuitId", "functionCode");

-- CreateIndex
CREATE INDEX "approval_opinions_companyId_requestType_requestId_idx" ON "approval_opinions"("companyId", "requestType", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_opinions_requestType_requestId_functionCode_key" ON "approval_opinions"("requestType", "requestId", "functionCode");

-- CreateIndex
CREATE INDEX "approval_pending_decisions_companyId_state_idx" ON "approval_pending_decisions"("companyId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "approval_pending_decisions_requestType_requestId_key" ON "approval_pending_decisions"("requestType", "requestId");

-- AddForeignKey
ALTER TABLE "user_approval_functions" ADD CONSTRAINT "user_approval_functions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_approval_functions" ADD CONSTRAINT "user_approval_functions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_circuits" ADD CONSTRAINT "approval_circuits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_circuit_steps" ADD CONSTRAINT "approval_circuit_steps_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "approval_circuits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
