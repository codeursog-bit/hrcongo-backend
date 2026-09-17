-- AlterTable
ALTER TABLE "users" ADD COLUMN     "manageMultipleCompanies" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxCompanies" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "user_companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_companies_userId_idx" ON "user_companies"("userId");

-- CreateIndex
CREATE INDEX "user_companies_companyId_idx" ON "user_companies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_companies_userId_companyId_key" ON "user_companies"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
