/*
  Warnings:

  - Changed the type of `type` on the `documents` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('CNI', 'PASSPORT', 'DRIVER_LICENSE', 'CONTRACT', 'AVENANT', 'PAYSLIP', 'WORK_CERTIFICATE', 'SALARY_ATTESTATION', 'EMPLOYMENT_LETTER', 'DIPLOMA', 'CERTIFICATION', 'TRAINING_CERT', 'MEDICAL_CERT', 'MEDICAL_VISIT', 'RESUME', 'RIB', 'OTHER');

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "type",
ADD COLUMN     "type" "document_type" NOT NULL;

-- DropEnum
DROP TYPE "document_types";

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "performance_reviews_status_idx" ON "performance_reviews"("status");
