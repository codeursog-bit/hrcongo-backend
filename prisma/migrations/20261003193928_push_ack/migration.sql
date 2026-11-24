-- AlterTable
ALTER TABLE "push_deliveries" ADD COLUMN     "ackAt" TIMESTAMPTZ,
ADD COLUMN     "ackedDevices" SMALLINT NOT NULL DEFAULT 0;
