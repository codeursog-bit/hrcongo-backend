/*
  Warnings:

  - A unique constraint covering the columns `[pairingCodeHash]` on the table `sync_connectors` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "sync_connectors" ADD COLUMN     "pairingCodeHash" VARCHAR(64),
ADD COLUMN     "pairingExpiresAt" TIMESTAMPTZ,
ALTER COLUMN "agentKeyHash" DROP NOT NULL,
ALTER COLUMN "agentKeyHint" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sync_connectors_pairingCodeHash_key" ON "sync_connectors"("pairingCodeHash");
