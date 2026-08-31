/*
  Warnings:

  - The values [COMPENSATORY] on the enum `leave_type` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[employeeId,cycleStartDate]` on the table `leave_balances` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AbsenceSubType" AS ENUM ('MALADIE', 'MATERNITE', 'PATERNITE', 'MARIAGE', 'DECES', 'NAISSANCE', 'AUTRE');

-- AlterEnum
BEGIN;
CREATE TYPE "leave_type_new" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPENSATORYANNUAL_ANTICIPATED');
ALTER TABLE "leaves" ALTER COLUMN "type" TYPE "leave_type_new" USING ("type"::text::"leave_type_new");
ALTER TYPE "leave_type" RENAME TO "leave_type_old";
ALTER TYPE "leave_type_new" RENAME TO "leave_type";
DROP TYPE "leave_type_old";
COMMIT;

-- AlterTable
ALTER TABLE "absence_requests" ADD COLUMN     "subType" "AbsenceSubType";

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "leaveCycleStartDate" DATE;

-- AlterTable
ALTER TABLE "leave_balances" ADD COLUMN     "cycleEndDate" DATE,
ADD COLUMN     "cycleNumber" INTEGER,
ADD COLUMN     "cycleStartDate" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_cycleStartDate_key" ON "leave_balances"("employeeId", "cycleStartDate");
