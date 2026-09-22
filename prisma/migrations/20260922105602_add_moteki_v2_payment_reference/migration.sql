/*
  Warnings:

  - A unique constraint covering the columns `[motekiPaymentReference]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "motekiPaymentReference" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "payments_motekiPaymentReference_key" ON "payments"("motekiPaymentReference");
