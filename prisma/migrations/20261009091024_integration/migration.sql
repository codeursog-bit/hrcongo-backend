/*
  Warnings:

  - A unique constraint covering the columns `[userId,deviceId]` on the table `push_subscriptions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "push_subscriptions" ADD COLUMN     "deviceId" VARCHAR(64),
ADD COLUMN     "disabledAt" TIMESTAMPTZ,
ADD COLUMN     "enabledAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastError" VARCHAR(300),
ADD COLUMN     "lastFailureAt" TIMESTAMPTZ,
ADD COLUMN     "lastSuccessAt" TIMESTAMPTZ,
ADD COLUMN     "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "userAgent" VARCHAR(300);

-- CreateTable
CREATE TABLE "push_device_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "deviceId" VARCHAR(64),
    "deviceLabel" VARCHAR(150),
    "type" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_broadcasts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdBy" UUID NOT NULL,
    "companyId" UUID,
    "onlyNotPunched" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(300) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "noDevice" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,

    CONSTRAINT "push_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_device_events_userId_createdAt_idx" ON "push_device_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "push_device_events_createdAt_idx" ON "push_device_events"("createdAt");

-- CreateIndex
CREATE INDEX "push_broadcasts_createdAt_idx" ON "push_broadcasts"("createdAt");

-- CreateIndex
CREATE INDEX "push_subscriptions_status_idx" ON "push_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_userId_deviceId_key" ON "push_subscriptions"("userId", "deviceId");
