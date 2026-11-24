-- AlterTable
ALTER TABLE "candidate_interviews" ADD COLUMN     "reminderSentAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "recruitment_email_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "templateId" VARCHAR(40) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recruitment_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_email_templates_companyId_templateId_key" ON "recruitment_email_templates"("companyId", "templateId");
