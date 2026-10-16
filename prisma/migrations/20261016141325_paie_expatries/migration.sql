-- CreateTable
CREATE TABLE "payroll_foreign_pays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "countryName" VARCHAR(100) NOT NULL,
    "payerName" VARCHAR(255),
    "grossAmount" DECIMAL(15,2) NOT NULL,
    "netAmount" DECIMAL(15,2) NOT NULL,
    "note" VARCHAR(500),
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payroll_foreign_pays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_foreign_pays_companyId_year_month_idx" ON "payroll_foreign_pays"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "payroll_foreign_pays_employeeId_idx" ON "payroll_foreign_pays"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_foreign_pays_employeeId_year_month_countryCode_key" ON "payroll_foreign_pays"("employeeId", "year", "month", "countryCode");

-- AddForeignKey
ALTER TABLE "payroll_foreign_pays" ADD CONSTRAINT "payroll_foreign_pays_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_foreign_pays" ADD CONSTRAINT "payroll_foreign_pays_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
