-- CreateEnum
CREATE TYPE "absence_type" AS ENUM ('MALADIE', 'CONVENTIONNELLE', 'EXCEPTIONNELLE');

-- CreateEnum
CREATE TYPE "absence_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "permission_type" AS ENUM ('URGENCE', 'MISSION', 'AUTRE');

-- CreateEnum
CREATE TYPE "mission_type" AS ENUM ('PROSPECTION_CLIENT', 'RECOUVREMENT', 'SAV', 'REPARATION_EXTERNE', 'AUTRE');

-- CreateEnum
CREATE TYPE "permission_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "loan_type" AS ENUM ('ARGENT', 'MARCHANDISE', 'AUTRE');

-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('OUI', 'NON');

-- CreateEnum
CREATE TYPE "repayment_method" AS ENUM ('PAYROLL', 'CASH');

-- CreateEnum
CREATE TYPE "company_deduction_status" AS ENUM ('PENDING', 'DEDUCTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "loan_status" ADD VALUE 'PENDING_DG';
ALTER TYPE "loan_status" ADD VALUE 'REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'ABSENCE_REQUEST';
ALTER TYPE "notification_type" ADD VALUE 'ABSENCE_APPROVED';
ALTER TYPE "notification_type" ADD VALUE 'ABSENCE_REJECTED';
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_REQUEST';
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_APPROVED';
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_REJECTED';
ALTER TYPE "notification_type" ADD VALUE 'LOAN_REQUEST';
ALTER TYPE "notification_type" ADD VALUE 'LOAN_APPROVED';
ALTER TYPE "notification_type" ADD VALUE 'LOAN_REJECTED';
ALTER TYPE "notification_type" ADD VALUE 'ADVANCE_REQUEST';
ALTER TYPE "notification_type" ADD VALUE 'ADVANCE_APPROVED';
ALTER TYPE "notification_type" ADD VALUE 'ADVANCE_REJECTED';

-- AlterTable
ALTER TABLE "advances" ADD COLUMN     "recoverViaPayroll" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rejectedAt" TIMESTAMPTZ,
ADD COLUMN     "rejectedBy" UUID,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requestedByUserId" UUID;

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "absenceRequestId" UUID;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "appliesSeniorityLeaveBonus" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "leaveConventionKey" VARCHAR(30) NOT NULL DEFAULT 'GENERALE';

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "extraDaysGranted" DECIMAL(5,2),
ADD COLUMN     "resumptionNote" TEXT;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "dgDecidedAt" TIMESTAMPTZ,
ADD COLUMN     "dgDecidedBy" UUID,
ADD COLUMN     "dgDecision" "approval_decision",
ADD COLUMN     "drhDecidedAt" TIMESTAMPTZ,
ADD COLUMN     "drhDecidedBy" UUID,
ADD COLUMN     "drhDecision" "approval_decision",
ADD COLUMN     "recoverViaPayroll" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requestedByUserId" UUID,
ADD COLUMN     "type" "loan_type" NOT NULL DEFAULT 'ARGENT';

-- CreateTable
CREATE TABLE "absence_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "type" "absence_type" NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "workingDays" DECIMAL(5,2) NOT NULL,
    "attachmentUrl" TEXT,
    "status" "absence_request_status" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMPTZ,
    "cancellationReason" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "absence_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "type" "permission_type" NOT NULL,
    "missionType" "mission_type",
    "reason" TEXT NOT NULL,
    "destination" VARCHAR(200),
    "departureTime" TIMESTAMPTZ NOT NULL,
    "expectedReturnTime" TIMESTAMPTZ NOT NULL,
    "actualReturnTime" TIMESTAMPTZ,
    "status" "permission_status" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "rejectionReason" TEXT,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "permission_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loanId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "repayment_method" NOT NULL,
    "recordedBy" UUID,
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_deductions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "status" "company_deduction_status" NOT NULL DEFAULT 'PENDING',
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "absence_requests_employeeId_status_idx" ON "absence_requests"("employeeId", "status");

-- CreateIndex
CREATE INDEX "absence_requests_companyId_idx" ON "absence_requests"("companyId");

-- CreateIndex
CREATE INDEX "absence_requests_status_idx" ON "absence_requests"("status");

-- CreateIndex
CREATE INDEX "permission_tickets_employeeId_status_idx" ON "permission_tickets"("employeeId", "status");

-- CreateIndex
CREATE INDEX "permission_tickets_companyId_idx" ON "permission_tickets"("companyId");

-- CreateIndex
CREATE INDEX "permission_tickets_status_idx" ON "permission_tickets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_logs_loanId_month_year_key" ON "loan_repayment_logs"("loanId", "month", "year");

-- CreateIndex
CREATE INDEX "company_deductions_employeeId_idx" ON "company_deductions"("employeeId");

-- CreateIndex
CREATE INDEX "company_deductions_companyId_month_year_idx" ON "company_deductions"("companyId", "month", "year");

-- AddForeignKey
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_tickets" ADD CONSTRAINT "permission_tickets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_tickets" ADD CONSTRAINT "permission_tickets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_tickets" ADD CONSTRAINT "permission_tickets_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_tickets" ADD CONSTRAINT "permission_tickets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_absenceRequestId_fkey" FOREIGN KEY ("absenceRequestId") REFERENCES "absence_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_logs" ADD CONSTRAINT "loan_repayment_logs_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_deductions" ADD CONSTRAINT "company_deductions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_deductions" ADD CONSTRAINT "company_deductions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
