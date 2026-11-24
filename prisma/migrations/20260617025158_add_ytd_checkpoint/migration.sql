-- CreateTable
CREATE TABLE "ytd_checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "brut" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netImp" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "chargesSal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "chargesPat" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ytd_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ytd_checkpoints_employeeId_effectiveDate_idx" ON "ytd_checkpoints"("employeeId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "ytd_checkpoints" ADD CONSTRAINT "ytd_checkpoints_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
