-- CreateEnum
CREATE TYPE "custom_quote_status" AS ENUM ('ACTIVE', 'USED', 'CANCELED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "customQuoteId" UUID,
ADD COLUMN     "discountAmount" INTEGER,
ADD COLUMN     "discountCodeId" UUID,
ADD COLUMN     "originalAmount" INTEGER;

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "paymentProvider" "payment_provider" NOT NULL DEFAULT 'YABETOOPAY';

-- CreateTable
CREATE TABLE "plan_prices" (
    "plan" "subscription_plan" NOT NULL,
    "priceMonthly" INTEGER NOT NULL,
    "priceYearly" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("plan")
);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "companyId" UUID,
    "maxUses" INTEGER,
    "maxUsesPerCompany" INTEGER,
    "validFrom" TIMESTAMPTZ,
    "validUntil" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "discountCodeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "finalAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "plan" "subscription_plan" NOT NULL,
    "amount" INTEGER NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "status" "custom_quote_status" NOT NULL DEFAULT 'ACTIVE',
    "validUntil" TIMESTAMPTZ,
    "usedAt" TIMESTAMPTZ,
    "note" VARCHAR(500),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "custom_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" VARCHAR(30) NOT NULL,
    "paymentId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "paymentInfo" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "vatAmount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'XAF',
    "sentTo" TEXT[],
    "emailSentAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_codes_companyId_idx" ON "discount_codes"("companyId");

-- CreateIndex
CREATE INDEX "discount_codes_isActive_idx" ON "discount_codes"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_paymentId_key" ON "discount_redemptions"("paymentId");

-- CreateIndex
CREATE INDEX "discount_redemptions_discountCodeId_idx" ON "discount_redemptions"("discountCodeId");

-- CreateIndex
CREATE INDEX "discount_redemptions_companyId_idx" ON "discount_redemptions"("companyId");

-- CreateIndex
CREATE INDEX "custom_quotes_companyId_status_idx" ON "custom_quotes"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentId_key" ON "invoices"("paymentId");

-- CreateIndex
CREATE INDEX "invoices_companyId_issuedAt_idx" ON "invoices"("companyId", "issuedAt");

-- CreateIndex
CREATE INDEX "payments_discountCodeId_idx" ON "payments"("discountCodeId");

-- CreateIndex
CREATE INDEX "payments_customQuoteId_idx" ON "payments"("customQuoteId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customQuoteId_fkey" FOREIGN KEY ("customQuoteId") REFERENCES "custom_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_quotes" ADD CONSTRAINT "custom_quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
