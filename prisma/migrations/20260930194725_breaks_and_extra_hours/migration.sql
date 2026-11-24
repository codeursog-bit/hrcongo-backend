-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "breakMinutes" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "extraHoursInfo" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "payroll_settings" ADD COLUMN     "breakDurationMinutes" SMALLINT NOT NULL DEFAULT 60,
ADD COLUMN     "breakEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "breakLateToleranceMinutes" SMALLINT NOT NULL DEFAULT 35,
ADD COLUMN     "breakStartHour" SMALLINT NOT NULL DEFAULT 12,
ADD COLUMN     "breakStartMinute" SMALLINT NOT NULL DEFAULT 0;
