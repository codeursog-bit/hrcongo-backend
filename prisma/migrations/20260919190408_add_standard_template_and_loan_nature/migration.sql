-- CreateEnum
CREATE TYPE "loan_nature" AS ENUM ('SOCIAL', 'SCOLARITE', 'LOGEMENT', 'EXCEPTIONNEL', 'AUTRE');

-- AlterEnum
ALTER TYPE "document_template" ADD VALUE 'STANDARD';

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "nature" "loan_nature";
