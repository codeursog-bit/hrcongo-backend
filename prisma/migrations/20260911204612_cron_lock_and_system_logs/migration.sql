-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "preShiftReminderMinutes" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
