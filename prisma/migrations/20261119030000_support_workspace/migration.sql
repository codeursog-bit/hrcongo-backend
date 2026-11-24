-- AlterEnum
ALTER TYPE "user_role" ADD VALUE 'SUPPORT';

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requesterId" UUID,
    "contactId" UUID,
    "requesterName" VARCHAR(201) NOT NULL,
    "requesterEmail" VARCHAR(255) NOT NULL,
    "companyLabel" VARCHAR(150),
    "subject" VARCHAR(150) NOT NULL,
    "category" VARCHAR(20) NOT NULL DEFAULT 'QUESTION',
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "assigneeId" UUID,
    "guestTokenHash" VARCHAR(64),
    "guestExpiresAt" TIMESTAMPTZ,
    "requesterReadSeq" INTEGER NOT NULL DEFAULT 0,
    "staffReadSeq" INTEGER NOT NULL DEFAULT 0,
    "lastCustomerSeq" INTEGER NOT NULL DEFAULT 0,
    "lastStaffSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" SERIAL NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID,
    "side" VARCHAR(10) NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "clientId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_contactId_key" ON "support_tickets"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_guestTokenHash_key" ON "support_tickets"("guestTokenHash");

-- CreateIndex
CREATE INDEX "support_tickets_requesterId_updatedAt_idx" ON "support_tickets"("requesterId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_status_updatedAt_idx" ON "support_tickets"("status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_assigneeId_idx" ON "support_tickets"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_seq_key" ON "support_messages"("seq");

-- CreateIndex
CREATE INDEX "support_messages_ticketId_seq_idx" ON "support_messages"("ticketId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_ticketId_clientId_key" ON "support_messages"("ticketId", "clientId");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
