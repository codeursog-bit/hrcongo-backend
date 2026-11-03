-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "leaveAppliesToContractors" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "balanceDebitedAt" TIMESTAMP(3);

-- Rattrapage : les congés déjà validés ont déjà été débités à leur planification
UPDATE "leaves"
SET "balanceDebitedAt" = COALESCE("updatedAt", "createdAt")
WHERE "status" = 'APPROVED'
  AND "type" IN ('ANNUAL', 'ANNUAL_ANTICIPATED')
  AND "carriedFromLeaveId" IS NULL;