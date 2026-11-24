-- No inference from CNSS number, payroll deductions, or monthly declarations.
-- Existing employees remain unverified until RH explicitly confirms their status.
ALTER TABLE "employees" ADD COLUMN "cnssEmployeeDeclared" BOOLEAN;
