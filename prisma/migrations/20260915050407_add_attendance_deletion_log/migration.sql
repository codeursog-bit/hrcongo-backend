-- CreateTable
CREATE TABLE "attendance_deletion_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceDate" VARCHAR(10) NOT NULL,
    "checkIn" TIMESTAMPTZ,
    "checkOut" TIMESTAMPTZ,
    "deletedBy" UUID NOT NULL,
    "deletedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "ipAddress" INET,
    "userAgent" TEXT,

    CONSTRAINT "attendance_deletion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_deletion_logs_companyId_idx" ON "attendance_deletion_logs"("companyId");

-- CreateIndex
CREATE INDEX "attendance_deletion_logs_deletedBy_idx" ON "attendance_deletion_logs"("deletedBy");
