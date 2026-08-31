-- AlterTable
ALTER TABLE "payroll_items" ADD COLUMN     "empAmount" DECIMAL(15,2),
ADD COLUMN     "empRate" VARCHAR(20),
ADD COLUMN     "quantity" DOUBLE PRECISION;
