ALTER TYPE "subscription_plan" ADD VALUE IF NOT EXISTS 'STARTER';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "featureOverrides" JSONB;
CREATE TABLE IF NOT EXISTS "subscription_usage" (
  "companyId" UUID NOT NULL REFERENCES "subscriptions"("companyId") ON DELETE CASCADE,
  "key" VARCHAR(64) NOT NULL,
  "period" VARCHAR(7) NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0 CHECK ("used" >= 0),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("companyId", "key", "period")
);
