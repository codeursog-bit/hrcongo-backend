-- AlterTable
ALTER TABLE "collective_agreement_rules" ALTER COLUMN "professionalCategory" SET DATA TYPE VARCHAR(50);

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "professionalCategory" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "echelon" SET DATA TYPE VARCHAR(50);
