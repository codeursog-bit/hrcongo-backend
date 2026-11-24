-- CreateEnum
CREATE TYPE "document_template" AS ENUM ('DEFAULT', 'ORCA');

-- AlterTable
ALTER TABLE "absence_requests" ADD COLUMN     "printAuthorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printAuthorizedAt" TIMESTAMPTZ,
ADD COLUMN     "printAuthorizedBy" UUID;

-- AlterTable
ALTER TABLE "advances" ADD COLUMN     "printAuthorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printAuthorizedAt" TIMESTAMPTZ,
ADD COLUMN     "printAuthorizedBy" UUID;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "cachetUrl" TEXT,
ADD COLUMN     "documentTemplate" "document_template" NOT NULL DEFAULT 'DEFAULT';

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "printAuthorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printAuthorizedAt" TIMESTAMPTZ,
ADD COLUMN     "printAuthorizedBy" UUID;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "printAuthorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printAuthorizedAt" TIMESTAMPTZ,
ADD COLUMN     "printAuthorizedBy" UUID;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_printAuthorizedBy_fkey" FOREIGN KEY ("printAuthorizedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_printAuthorizedBy_fkey" FOREIGN KEY ("printAuthorizedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_printAuthorizedBy_fkey" FOREIGN KEY ("printAuthorizedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_printAuthorizedBy_fkey" FOREIGN KEY ("printAuthorizedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
