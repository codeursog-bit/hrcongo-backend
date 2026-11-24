-- CreateEnum
CREATE TYPE "echelon_suggestion_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "echelonReminderEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "echelon_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conventionCode" VARCHAR(50) NOT NULL,
    "currentEchelonIndex" INTEGER NOT NULL,
    "suggestedEchelonIndex" INTEGER NOT NULL,
    "yearsCompleted" INTEGER NOT NULL,
    "anniversaryDate" DATE NOT NULL,
    "scheduledNotifyDate" DATE NOT NULL,
    "notifiedAt" TIMESTAMPTZ,
    "status" "echelon_suggestion_status" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMPTZ,
    "decidedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "echelon_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "echelon_suggestions_companyId_status_idx" ON "echelon_suggestions"("companyId", "status");

-- CreateIndex
CREATE INDEX "echelon_suggestions_employeeId_status_idx" ON "echelon_suggestions"("employeeId", "status");

-- CreateIndex
CREATE INDEX "echelon_suggestions_scheduledNotifyDate_notifiedAt_idx" ON "echelon_suggestions"("scheduledNotifyDate", "notifiedAt");

-- AddForeignKey
ALTER TABLE "echelon_suggestions" ADD CONSTRAINT "echelon_suggestions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echelon_suggestions" ADD CONSTRAINT "echelon_suggestions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
