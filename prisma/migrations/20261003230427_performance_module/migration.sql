/*
  Warnings:

  - A unique constraint covering the columns `[cycleId,employeeId]` on the table `performance_reviews` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "review_cycle_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "competency_category" AS ENUM ('TECHNICAL', 'BEHAVIORAL', 'MANAGERIAL');

-- CreateEnum
CREATE TYPE "career_event_type" AS ENUM ('POSITION_CHANGE', 'DEPARTMENT_CHANGE', 'ECHELON_CHANGE', 'CONTRACT_CHANGE', 'PROMOTION', 'CONFIRMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "promotion_type" AS ENUM ('POSITION_CHANGE', 'ECHELON_MERIT', 'OTHER');

-- CreateEnum
CREATE TYPE "promotion_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "development_plan_status" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "development_action_type" AS ENUM ('TRAINING', 'MENTORING', 'PROJECT', 'SELF_STUDY', 'OTHER');

-- CreateEnum
CREATE TYPE "development_action_status" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "evaluatedInReviewId" UUID,
ADD COLUMN     "kpi" TEXT,
ADD COLUMN     "managerComment" TEXT,
ADD COLUMN     "plannedInReviewId" UUID,
ADD COLUMN     "score" SMALLINT,
ADD COLUMN     "support" VARCHAR(255),
ADD COLUMN     "validatedAt" TIMESTAMPTZ,
ADD COLUMN     "weight" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "performance_reviews" ADD COLUMN     "competenciesScore" DECIMAL(4,2),
ADD COLUMN     "cycleId" UUID,
ADD COLUMN     "employeeComment" TEXT,
ADD COLUMN     "employeeCommentAt" TIMESTAMPTZ,
ADD COLUMN     "objectivesScore" DECIMAL(4,2),
ADD COLUMN     "selfAssessment" JSONB,
ADD COLUMN     "selfSubmittedAt" TIMESTAMPTZ,
ADD COLUMN     "verdict" VARCHAR(40);

-- CreateTable
CREATE TABLE "review_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "review_type" NOT NULL DEFAULT 'QUARTERLY',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "review_cycle_status" NOT NULL DEFAULT 'OPEN',
    "objectivesWeight" SMALLINT NOT NULL DEFAULT 80,
    "selfAssessmentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "templateId" UUID,
    "createdById" UUID NOT NULL,
    "launchedAt" TIMESTAMPTZ,
    "closedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "jobTitle" VARCHAR(100),
    "criteria" JSONB NOT NULL,
    "objectives" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "evaluation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "competency_category" NOT NULL DEFAULT 'TECHNICAL',
    "description" TEXT,
    "levels" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_profile_competencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobProfileId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "requiredLevel" SMALLINT NOT NULL DEFAULT 3,

    CONSTRAINT "job_profile_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "level" SMALLINT NOT NULL,
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "reviewId" UUID,
    "assessedById" UUID,
    "comment" TEXT,
    "assessedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_courses" (
    "competencyId" UUID NOT NULL,
    "courseId" UUID NOT NULL,

    CONSTRAINT "competency_courses_pkey" PRIMARY KEY ("competencyId","courseId")
);

-- CreateTable
CREATE TABLE "career_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "career_event_type" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "fromValue" VARCHAR(120),
    "toValue" VARCHAR(120),
    "notes" TEXT,
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "proposalId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "promotion_type" NOT NULL,
    "currentValue" VARCHAR(120),
    "targetValue" VARCHAR(120) NOT NULL,
    "justification" TEXT NOT NULL,
    "reviewId" UUID,
    "status" "promotion_status" NOT NULL DEFAULT 'PENDING',
    "proposedById" UUID NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ,
    "decisionComment" TEXT,
    "effectiveDate" DATE,
    "appliedToEmployee" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "promotion_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "status" "development_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "dueDate" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "development_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planId" UUID NOT NULL,
    "type" "development_action_type" NOT NULL DEFAULT 'OTHER',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "development_action_status" NOT NULL DEFAULT 'TODO',
    "dueDate" DATE,
    "completedAt" TIMESTAMPTZ,
    "employeeNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "competencyId" UUID,
    "courseId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "development_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_cycles_companyId_status_idx" ON "review_cycles"("companyId", "status");

-- CreateIndex
CREATE INDEX "evaluation_templates_companyId_idx" ON "evaluation_templates"("companyId");

-- CreateIndex
CREATE INDEX "competencies_companyId_idx" ON "competencies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_companyId_name_key" ON "competencies"("companyId", "name");

-- CreateIndex
CREATE INDEX "job_profiles_companyId_idx" ON "job_profiles"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "job_profiles_companyId_title_key" ON "job_profiles"("companyId", "title");

-- CreateIndex
CREATE INDEX "job_profile_competencies_competencyId_idx" ON "job_profile_competencies"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "job_profile_competencies_jobProfileId_competencyId_key" ON "job_profile_competencies"("jobProfileId", "competencyId");

-- CreateIndex
CREATE INDEX "competency_assessments_employeeId_competencyId_assessedAt_idx" ON "competency_assessments"("employeeId", "competencyId", "assessedAt");

-- CreateIndex
CREATE INDEX "competency_assessments_reviewId_idx" ON "competency_assessments"("reviewId");

-- CreateIndex
CREATE INDEX "career_events_employeeId_effectiveDate_idx" ON "career_events"("employeeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "career_events_companyId_idx" ON "career_events"("companyId");

-- CreateIndex
CREATE INDEX "promotion_proposals_companyId_status_idx" ON "promotion_proposals"("companyId", "status");

-- CreateIndex
CREATE INDEX "promotion_proposals_employeeId_idx" ON "promotion_proposals"("employeeId");

-- CreateIndex
CREATE INDEX "promotion_proposals_proposedById_idx" ON "promotion_proposals"("proposedById");

-- CreateIndex
CREATE INDEX "development_plans_employeeId_status_idx" ON "development_plans"("employeeId", "status");

-- CreateIndex
CREATE INDEX "development_plans_companyId_idx" ON "development_plans"("companyId");

-- CreateIndex
CREATE INDEX "development_actions_planId_idx" ON "development_actions"("planId");

-- CreateIndex
CREATE INDEX "goals_evaluatedInReviewId_idx" ON "goals"("evaluatedInReviewId");

-- CreateIndex
CREATE INDEX "goals_plannedInReviewId_idx" ON "goals"("plannedInReviewId");

-- CreateIndex
CREATE INDEX "performance_reviews_cycleId_idx" ON "performance_reviews"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_cycleId_employeeId_key" ON "performance_reviews"("cycleId", "employeeId");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_evaluatedInReviewId_fkey" FOREIGN KEY ("evaluatedInReviewId") REFERENCES "performance_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_plannedInReviewId_fkey" FOREIGN KEY ("plannedInReviewId") REFERENCES "performance_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "evaluation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_templates" ADD CONSTRAINT "evaluation_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profiles" ADD CONSTRAINT "job_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_competencies" ADD CONSTRAINT "job_profile_competencies_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "job_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_competencies" ADD CONSTRAINT "job_profile_competencies_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_assessments" ADD CONSTRAINT "competency_assessments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_assessments" ADD CONSTRAINT "competency_assessments_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_courses" ADD CONSTRAINT "competency_courses_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_courses" ADD CONSTRAINT "competency_courses_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_events" ADD CONSTRAINT "career_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_events" ADD CONSTRAINT "career_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_proposals" ADD CONSTRAINT "promotion_proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_proposals" ADD CONSTRAINT "promotion_proposals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "development_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
