-- CreateTable
CREATE TABLE "AccountingPlanVersion" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'CG',
    "effectiveFrom" DATE NOT NULL,
    "accounts" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingPlanVersion_countryCode_effectiveFrom_idx" ON "AccountingPlanVersion"("countryCode", "effectiveFrom");
