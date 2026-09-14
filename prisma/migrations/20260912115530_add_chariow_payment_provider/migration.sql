/*
  Warnings:

  - A unique constraint covering the columns `[chariowSaleId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "payment_provider" ADD VALUE 'CHARIOW';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "chariowCustomerEmail" VARCHAR(255),
ADD COLUMN     "chariowDiscountCode" VARCHAR(100),
ADD COLUMN     "chariowProductId" VARCHAR(100),
ADD COLUMN     "chariowSaleId" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "payments_chariowSaleId_key" ON "payments"("chariowSaleId");
