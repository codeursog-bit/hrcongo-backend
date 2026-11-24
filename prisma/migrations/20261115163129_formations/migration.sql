-- CreateEnum
CREATE TYPE "training_session_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "training_attendance_status" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED', 'LATE');

-- AlterTable
ALTER TABLE "employee_trainings" ADD COLUMN     "sessionId" UUID;

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "courseId" UUID NOT NULL,
    "label" VARCHAR(120),
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "location" VARCHAR(255),
    "trainerName" VARCHAR(120),
    "capacity" SMALLINT,
    "status" "training_session_status" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "convocationSentAt" TIMESTAMPTZ,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeTrainingId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "training_attendance_status" NOT NULL DEFAULT 'PRESENT',
    "note" VARCHAR(255),
    "markedById" UUID,
    "markedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_sessions_courseId_idx" ON "training_sessions"("courseId");

-- CreateIndex
CREATE INDEX "training_sessions_startDate_idx" ON "training_sessions"("startDate");

-- CreateIndex
CREATE INDEX "training_attendances_date_idx" ON "training_attendances"("date");

-- CreateIndex
CREATE UNIQUE INDEX "training_attendances_employeeTrainingId_date_key" ON "training_attendances"("employeeTrainingId", "date");

-- CreateIndex
CREATE INDEX "employee_trainings_sessionId_idx" ON "employee_trainings"("sessionId");

-- AddForeignKey
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "training_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attendances" ADD CONSTRAINT "training_attendances_employeeTrainingId_fkey" FOREIGN KEY ("employeeTrainingId") REFERENCES "employee_trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
