-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "selfServiceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selfServiceEnabledAt" TIMESTAMP(3),
ADD COLUMN     "selfServiceEnabledBy" VARCHAR(150);
