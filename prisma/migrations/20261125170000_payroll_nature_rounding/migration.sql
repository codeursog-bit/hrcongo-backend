ALTER TABLE "payroll_settings" ADD COLUMN "salaryRoundingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employee_bonuses" ADD COLUMN "isNature" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payroll_items" ADD COLUMN "isNature" BOOLEAN NOT NULL DEFAULT false;
