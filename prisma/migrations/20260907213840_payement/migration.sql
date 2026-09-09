/*
  Warnings:

  - A unique constraint covering the columns `[motekiOrderId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[motekiOrderNumber]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[motekiSubscriptionId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "subscription_billing_cycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('YABETOOPAY', 'MOTEKI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'SUBSCRIPTION_EXPIRING';
ALTER TYPE "notification_type" ADD VALUE 'SUBSCRIPTION_EXPIRED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "motekiCustomerEmail" VARCHAR(255),
ADD COLUMN     "motekiOrderId" VARCHAR(100),
ADD COLUMN     "motekiOrderNumber" VARCHAR(100),
ADD COLUMN     "motekiSubscriptionId" VARCHAR(100),
ADD COLUMN     "provider" "payment_provider" NOT NULL DEFAULT 'YABETOOPAY',
ALTER COLUMN "yabetooIntentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingCycle" "subscription_billing_cycle" NOT NULL DEFAULT 'MONTHLY';

-- CreateIndex
CREATE UNIQUE INDEX "payments_motekiOrderId_key" ON "payments"("motekiOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_motekiOrderNumber_key" ON "payments"("motekiOrderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_motekiSubscriptionId_key" ON "payments"("motekiSubscriptionId");
