/*
  Warnings:

  - The values [COMPENSATORYANNUAL_ANTICIPATED] on the enum `leave_type` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "leave_type_new" AS ENUM ('ANNUAL', 'ANNUAL_ANTICIPATED', 'COMPENSATORY', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID');
ALTER TABLE "leaves" ALTER COLUMN "type" TYPE "leave_type_new" USING ("type"::text::"leave_type_new");
ALTER TYPE "leave_type" RENAME TO "leave_type_old";
ALTER TYPE "leave_type_new" RENAME TO "leave_type";
DROP TYPE "leave_type_old";
COMMIT;
