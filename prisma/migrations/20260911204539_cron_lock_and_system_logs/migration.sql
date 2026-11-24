-- CreateTable
CREATE TABLE "cron_locks" (
    "name" VARCHAR(100) NOT NULL,
    "lockedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cron_locks_pkey" PRIMARY KEY ("name")
);
