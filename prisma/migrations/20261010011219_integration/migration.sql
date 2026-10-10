-- CreateTable
CREATE TABLE "server_metric_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,
    "tables" JSONB,
    "routes" JSONB,

    CONSTRAINT "server_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_metric_snapshots_createdAt_idx" ON "server_metric_snapshots"("createdAt");
