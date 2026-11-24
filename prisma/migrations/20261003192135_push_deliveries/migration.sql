-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "tag" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL,
    "devicesTotal" SMALLINT NOT NULL DEFAULT 0,
    "devicesOk" SMALLINT NOT NULL DEFAULT 0,
    "error" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_deliveries_userId_createdAt_idx" ON "push_deliveries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "push_deliveries_createdAt_idx" ON "push_deliveries"("createdAt");

-- CreateIndex
CREATE INDEX "push_deliveries_status_idx" ON "push_deliveries"("status");
