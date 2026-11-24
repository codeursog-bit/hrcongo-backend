-- CreateTable
CREATE TABLE "attendance_breaks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendanceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "expectedEndAt" TIMESTAMPTZ NOT NULL,
    "endedAt" TIMESTAMPTZ,
    "minutes" INTEGER,
    "lateMinutes" INTEGER,
    "resumedAuto" BOOLEAN NOT NULL DEFAULT false,
    "lateNotifiedAt" TIMESTAMPTZ,
    "endMethod" "punch_method",
    "endSource" VARCHAR(100),
    "endLat" DECIMAL(10,8),
    "endLon" DECIMAL(11,8),
    "editedBy" UUID,
    "editReason" TEXT,
    "editedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "attendance_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_breaks_attendanceId_key" ON "attendance_breaks"("attendanceId");

-- CreateIndex
CREATE INDEX "attendance_breaks_companyId_idx" ON "attendance_breaks"("companyId");

-- CreateIndex
CREATE INDEX "attendance_breaks_employeeId_idx" ON "attendance_breaks"("employeeId");

-- AddForeignKey
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
