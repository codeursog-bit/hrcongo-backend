/*
  Warnings:

  - The values [SHARED] on the enum `review_status` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `uploadedBy` on the `documents` table. All the data in the column will be lost.
  - Changed the type of `type` on the `documents` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "review_type" AS ENUM ('ANNUAL', 'PROBATION', 'QUARTERLY', 'EXCEPTIONAL');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "document_types" AS ENUM ('CNI', 'PASSPORT', 'VITALE', 'DIPLOMA', 'CONTRAT', 'AVENANT', 'PAYSLIP', 'RIB', 'MUTUELLE');

-- AlterEnum
BEGIN;
CREATE TYPE "review_status_new" AS ENUM ('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED');
ALTER TABLE "performance_reviews" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "performance_reviews" ALTER COLUMN "status" TYPE "review_status_new" USING ("status"::text::"review_status_new");
ALTER TYPE "review_status" RENAME TO "review_status_old";
ALTER TYPE "review_status_new" RENAME TO "review_status";
DROP TYPE "review_status_old";
ALTER TABLE "performance_reviews" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "uploadedBy",
ADD COLUMN     "documentNumber" VARCHAR(100),
ADD COLUMN     "expiresAt" DATE,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issuedAt" DATE,
ADD COLUMN     "issuingBody" VARCHAR(255),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "replacedById" UUID,
ADD COLUMN     "status" "document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
ADD COLUMN     "uploadedById" UUID,
ADD COLUMN     "verifiedAt" TIMESTAMPTZ,
ADD COLUMN     "verifiedById" UUID,
ADD COLUMN     "version" SMALLINT NOT NULL DEFAULT 1,
DROP COLUMN "type",
ADD COLUMN     "type" "document_types" NOT NULL;

-- AlterTable
ALTER TABLE "performance_reviews" ADD COLUMN     "acknowledgedAt" TIMESTAMPTZ,
ADD COLUMN     "acknowledgedBy" UUID,
ADD COLUMN     "criteria" JSONB,
ADD COLUMN     "improvements" TEXT,
ADD COLUMN     "nextGoals" TEXT,
ADD COLUMN     "overallScore" DECIMAL(4,2),
ADD COLUMN     "reviewType" VARCHAR(30),
ADD COLUMN     "strengths" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMPTZ;

-- DropEnum
DROP TYPE "document_type";

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_expiresAt_idx" ON "documents"("expiresAt");

-- CreateIndex
CREATE INDEX "documents_isArchived_idx" ON "documents"("isArchived");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
