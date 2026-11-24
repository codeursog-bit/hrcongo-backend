ALTER TABLE "employees" ADD COLUMN "recordDeletedAt" TIMESTAMPTZ;
ALTER TABLE "employees" ADD COLUMN "recordDeletedBy" UUID;
ALTER TABLE "employees" ADD COLUMN "recordDeletedStatus" "employee_status";
CREATE INDEX "employees_companyId_recordDeletedAt_idx" ON "employees"("companyId", "recordDeletedAt");

-- Anciennes suppressions : uniquement celles attestées par un audit réussi.
-- Ne pas inventer un motif/date de départ et conserver les vraies ruptures.
WITH deletions AS (
  SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "userId"
  FROM "activity_logs"
  WHERE "entity" = 'EMPLOYEE' AND "action" = 'EMPLOYEE_DELETE' AND "entityId" IS NOT NULL
  ORDER BY "entityId", "createdAt" DESC
)
UPDATE "employees" e SET "recordDeletedAt" = d."createdAt", "recordDeletedBy" = d."userId"
FROM deletions d WHERE e."id" = d."entityId"
  AND e."status" = 'TERMINATED'
  AND e."terminationDate" = (d."createdAt" AT TIME ZONE 'UTC')::date
  AND e."updatedAt" <= d."createdAt"
  AND e."updatedAt" >= d."createdAt" - INTERVAL '5 minutes';
