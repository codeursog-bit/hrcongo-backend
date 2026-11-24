-- AlterEnum (notifications liées au retour de permission)
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_RETURN_REQUEST';
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_RETURN_CONFIRMED';
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_RETURN_REJECTED';
ALTER TYPE "notification_type" ADD VALUE 'PERMISSION_TIMES_EDITED';

-- CreateEnum
CREATE TYPE "permission_return_status" AS ENUM ('NOT_RETURNED', 'PENDING_VALIDATION', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "permission_event_type" AS ENUM ('CREATED', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURN_DECLARED', 'RETURN_CONFIRMED', 'RETURN_REJECTED', 'TIMES_EDITED');

-- AlterTable
ALTER TABLE "permission_tickets"
  ADD COLUMN "actualDepartureTime" TIMESTAMPTZ,
  ADD COLUMN "returnStatus" "permission_return_status" NOT NULL DEFAULT 'NOT_RETURNED',
  ADD COLUMN "returnDeclaredAt" TIMESTAMPTZ,
  ADD COLUMN "returnConfirmedBy" UUID,
  ADD COLUMN "returnConfirmedAt" TIMESTAMPTZ,
  ADD COLUMN "timesAdjusted" BOOLEAN NOT NULL DEFAULT false;

-- Rattrapage : les retours déjà enregistrés avant ce changement sont considérés comme confirmés
UPDATE "permission_tickets"
SET "returnStatus" = 'CONFIRMED',
    "returnDeclaredAt" = "actualReturnTime"
WHERE "actualReturnTime" IS NOT NULL;

-- CreateTable
CREATE TABLE "permission_ticket_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticketId" UUID NOT NULL,
    "type" "permission_event_type" NOT NULL,
    "actorUserId" UUID,
    "actorRole" VARCHAR(30),
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permission_ticket_events_ticketId_createdAt_idx" ON "permission_ticket_events"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "permission_tickets" ADD CONSTRAINT "permission_tickets_returnConfirmedBy_fkey" FOREIGN KEY ("returnConfirmedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_ticket_events" ADD CONSTRAINT "permission_ticket_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "permission_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_ticket_events" ADD CONSTRAINT "permission_ticket_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rattrapage historique : une ligne « création » par ticket existant, pour que la timeline ne soit jamais vide
INSERT INTO "permission_ticket_events" ("ticketId", "type", "actorUserId", "createdAt")
SELECT "id", 'CREATED', "createdByUserId", "createdAt" FROM "permission_tickets";
