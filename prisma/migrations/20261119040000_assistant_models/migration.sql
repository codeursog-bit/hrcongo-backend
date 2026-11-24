ALTER TABLE "AssistantSettings"
  ADD COLUMN "licenseConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "licenseProvider" VARCHAR(30),
  ADD COLUMN "licenseDate" TIMESTAMPTZ,
  ADD COLUMN "licenseReference" VARCHAR(200),
  ADD COLUMN "provider" VARCHAR(30),
  ADD COLUMN "model" VARCHAR(120);
