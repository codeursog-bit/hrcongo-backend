
CREATE TABLE "compta_connectors" (
"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "companyId" UUID NOT NULL UNIQUE REFERENCES "companies"("id") ON DELETE CASCADE,
"ownerUserId" UUID NOT NULL, "remoteCompanyId" UUID NOT NULL, "remoteLinkId" UUID NOT NULL, "remoteCompanyName" TEXT NOT NULL,
"secretEnc" TEXT NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT true,"mappings" JSONB NOT NULL DEFAULT '{}',
"lastSyncAt" TIMESTAMPTZ,"lastError" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE "compta_deliveries" (
"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"connectorId" UUID NOT NULL REFERENCES "compta_connectors"("id") ON DELETE CASCADE,
"payrollId" UUID NOT NULL REFERENCES "payrolls"("id") ON DELETE RESTRICT,"externalId" TEXT NOT NULL,"payload" JSONB NOT NULL,"payloadHash" TEXT NOT NULL,"state" TEXT NOT NULL DEFAULT 'PENDING',
"remoteEventId" TEXT,"attempts" INTEGER NOT NULL DEFAULT 0,"detail" TEXT,"nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT now(),"leaseUntil" TIMESTAMPTZ,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
CONSTRAINT "compta_deliveries_connectorId_externalId_key" UNIQUE ("connectorId","externalId"));
CREATE INDEX "compta_deliveries_connectorId_state_nextAttemptAt_idx" ON "compta_deliveries"("connectorId","state","nextAttemptAt");
CREATE TABLE "compta_receipts" (
"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"connectorId" UUID NOT NULL REFERENCES "compta_connectors"("id") ON DELETE CASCADE,
"externalId" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
CONSTRAINT "compta_receipts_connectorId_externalId_key" UNIQUE ("connectorId","externalId"));

