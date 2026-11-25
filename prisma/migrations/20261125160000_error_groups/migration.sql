CREATE TABLE "error_groups" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "fingerprint" VARCHAR(64) NOT NULL,
 "source" VARCHAR(20) NOT NULL, "severity" VARCHAR(20) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'NEW',
 "firstSeen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "count" INTEGER NOT NULL DEFAULT 0, "companyCount" INTEGER NOT NULL DEFAULT 0, "userCount" INTEGER NOT NULL DEFAULT 0,
 "version" VARCHAR(100), "note" VARCHAR(2000), CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "users" ADD COLUMN "incidentEmailAlerts" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "error_groups_fingerprint_key" ON "error_groups"("fingerprint");
CREATE INDEX "error_groups_status_severity_lastSeen_idx" ON "error_groups"("status", "severity", "lastSeen");
CREATE INDEX "error_groups_source_lastSeen_idx" ON "error_groups"("source", "lastSeen");
CREATE TABLE "error_group_actors" (
 "groupId" UUID NOT NULL, "kind" VARCHAR(10) NOT NULL, "actorId" UUID NOT NULL,
 CONSTRAINT "error_group_actors_pkey" PRIMARY KEY ("groupId", "kind", "actorId"),
 CONSTRAINT "error_group_actors_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "error_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "error_group_actors_kind_actorId_idx" ON "error_group_actors"("kind", "actorId");
ALTER TABLE "app_errors" ADD COLUMN "groupId" UUID, ADD COLUMN "context" JSONB, ADD COLUMN "occurrences" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "app_errors_groupId_createdAt_idx" ON "app_errors"("groupId", "createdAt");
ALTER TABLE "app_errors" ADD CONSTRAINT "app_errors_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "error_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
