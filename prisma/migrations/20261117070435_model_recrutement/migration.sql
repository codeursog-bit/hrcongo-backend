-- CreateEnum
CREATE TYPE "candidate_activity_type" AS ENUM ('STATUS_CHANGE', 'NOTE', 'INTERVIEW', 'EMAIL', 'OFFER', 'HIRE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "interview_kind" AS ENUM ('PHONE_SCREEN', 'HR', 'TECHNICAL', 'MANAGER', 'DIRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "interview_mode" AS ENUM ('ONSITE', 'VIDEO', 'PHONE');

-- CreateEnum
CREATE TYPE "interview_status" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "interview_recommendation" AS ENUM ('STRONG_YES', 'YES', 'NO', 'STRONG_NO');

-- CreateEnum
CREATE TYPE "requisition_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "requisition_reason" AS ENUM ('REPLACEMENT', 'NEW_POSITION', 'REINFORCEMENT', 'SEASONAL');

-- CreateEnum
CREATE TYPE "requisition_priority" AS ENUM ('NORMAL', 'URGENT');

-- DropForeignKey
ALTER TABLE "job_offers" DROP CONSTRAINT "job_offers_departmentId_fkey";

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "hiredAt" TIMESTAMPTZ,
ADD COLUMN     "hiredEmployeeId" UUID,
ADD COLUMN     "offerAcceptedAt" TIMESTAMPTZ,
ADD COLUMN     "offerDeclinedAt" TIMESTAMPTZ,
ADD COLUMN     "offerSalary" DECIMAL(15,2),
ADD COLUMN     "offerSentAt" TIMESTAMPTZ,
ADD COLUMN     "offerStartDate" DATE,
ADD COLUMN     "rejectionReason" VARCHAR(60),
ADD COLUMN     "source" VARCHAR(60),
ADD COLUMN     "stageChangedAt" TIMESTAMPTZ,
ADD COLUMN     "talentPool" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "job_offers" ALTER COLUMN "departmentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "candidate_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "type" "candidate_activity_type" NOT NULL,
    "title" VARCHAR(255),
    "body" TEXT,
    "fromStatus" VARCHAR(40),
    "toStatus" VARCHAR(40),
    "metadata" JSONB,
    "authorId" UUID,
    "authorName" VARCHAR(150),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_interviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "round" SMALLINT NOT NULL DEFAULT 1,
    "kind" "interview_kind" NOT NULL DEFAULT 'HR',
    "mode" "interview_mode" NOT NULL DEFAULT 'ONSITE',
    "scheduledAt" TIMESTAMPTZ NOT NULL,
    "durationMin" SMALLINT NOT NULL DEFAULT 45,
    "location" VARCHAR(255),
    "meetingUrl" TEXT,
    "interviewers" VARCHAR(255),
    "status" "interview_status" NOT NULL DEFAULT 'SCHEDULED',
    "criteria" JSONB,
    "overallScore" SMALLINT,
    "recommendation" "interview_recommendation",
    "summary" TEXT,
    "feedbackAt" TIMESTAMPTZ,
    "invitationSentAt" TIMESTAMPTZ,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "candidate_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_requisitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "departmentId" UUID,
    "title" VARCHAR(255) NOT NULL,
    "headcount" SMALLINT NOT NULL DEFAULT 1,
    "contractType" "contract_type",
    "reason" "requisition_reason" NOT NULL DEFAULT 'NEW_POSITION',
    "priority" "requisition_priority" NOT NULL DEFAULT 'NORMAL',
    "justification" TEXT,
    "salaryMin" DECIMAL(15,2),
    "salaryMax" DECIMAL(15,2),
    "desiredStartDate" DATE,
    "status" "requisition_status" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "requestedByName" VARCHAR(150),
    "reviewedById" UUID,
    "reviewedByName" VARCHAR(150),
    "reviewedAt" TIMESTAMPTZ,
    "reviewNote" TEXT,
    "jobOfferId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_activities_candidateId_createdAt_idx" ON "candidate_activities"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "candidate_interviews_candidateId_idx" ON "candidate_interviews"("candidateId");

-- CreateIndex
CREATE INDEX "candidate_interviews_scheduledAt_idx" ON "candidate_interviews"("scheduledAt");

-- CreateIndex
CREATE INDEX "candidate_interviews_status_idx" ON "candidate_interviews"("status");

-- CreateIndex
CREATE INDEX "job_requisitions_companyId_status_idx" ON "job_requisitions"("companyId", "status");

-- CreateIndex
CREATE INDEX "job_requisitions_requestedById_idx" ON "job_requisitions"("requestedById");

-- CreateIndex
CREATE INDEX "candidates_talentPool_idx" ON "candidates"("talentPool");

-- CreateIndex
CREATE INDEX "candidates_stageChangedAt_idx" ON "candidates"("stageChangedAt");

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_activities" ADD CONSTRAINT "candidate_activities_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_interviews" ADD CONSTRAINT "candidate_interviews_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
