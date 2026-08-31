-- AlterTable
ALTER TABLE "BonusTemplate" ADD COLUMN     "defaultQuantity" DECIMAL(8,2),
ADD COLUMN     "fiscalType" VARCHAR(20),
ADD COLUMN     "quantityMode" VARCHAR(20),
ADD COLUMN     "unitAmount" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "seniorityMode" VARCHAR(10) NOT NULL DEFAULT 'AUTO';

-- AlterTable
ALTER TABLE "employee_bonuses" ADD COLUMN     "defaultQuantity" DECIMAL(8,2),
ADD COLUMN     "fiscalType" VARCHAR(20),
ADD COLUMN     "quantityMode" VARCHAR(20),
ADD COLUMN     "unitAmount" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "bonus_monthly_quantities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeBonusId" UUID NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL,
    "computedAmount" DECIMAL(15,2) NOT NULL,
    "note" VARCHAR(200),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bonus_monthly_quantities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bonus_monthly_quantities_employeeBonusId_idx" ON "bonus_monthly_quantities"("employeeBonusId");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_monthly_quantities_employeeBonusId_month_year_key" ON "bonus_monthly_quantities"("employeeBonusId", "month", "year");

-- AddForeignKey
ALTER TABLE "bonus_monthly_quantities" ADD CONSTRAINT "bonus_monthly_quantities_employeeBonusId_fkey" FOREIGN KEY ("employeeBonusId") REFERENCES "employee_bonuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
