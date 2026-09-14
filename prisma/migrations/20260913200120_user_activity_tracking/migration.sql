-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastActiveAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "daily_user_activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "companyId" UUID,
    "date" VARCHAR(10) NOT NULL,
    "firstSeenAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ NOT NULL,
    "activeMinutes" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_user_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_user_activity_date_idx" ON "daily_user_activity"("date");

-- CreateIndex
CREATE INDEX "daily_user_activity_companyId_idx" ON "daily_user_activity"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_user_activity_userId_date_key" ON "daily_user_activity"("userId", "date");

-- AddForeignKey
ALTER TABLE "daily_user_activity" ADD CONSTRAINT "daily_user_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
