BEGIN;
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "interfaceAppearance" JSONB;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "allowEmployeeCustomization" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interfaceAppearance" JSONB;

-- CreateTable
CREATE TABLE "DailyTask" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "departmentId" UUID,
    "scope" VARCHAR(10) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "status" VARCHAR(15) NOT NULL DEFAULT 'TODO',
    "dueDate" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "blockedReason" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DailyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTaskAssignee" (
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "DailyTaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "DailyTaskComment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAnnouncement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyEvent" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "eventKey" VARCHAR(150) NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "subjectId" UUID,
    "announcementId" UUID,
    "day" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DailyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReaction" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emoji" VARCHAR(8) NOT NULL,

    CONSTRAINT "DailyReaction_pkey" PRIMARY KEY ("eventId","userId","emoji")
);

-- CreateTable
CREATE TABLE "AnniversaryReceipt" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "dateKey" VARCHAR(10) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnniversaryReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyTask_companyId_scope_ownerId_idx" ON "DailyTask"("companyId", "scope", "ownerId");

-- CreateIndex
CREATE INDEX "DailyTask_companyId_departmentId_idx" ON "DailyTask"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "DailyTaskAssignee_userId_idx" ON "DailyTaskAssignee"("userId");

-- CreateIndex
CREATE INDEX "DailyTaskComment_taskId_createdAt_idx" ON "DailyTaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "DailyAnnouncement_companyId_createdAt_idx" ON "DailyAnnouncement"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEvent_announcementId_key" ON "DailyEvent"("announcementId");

-- CreateIndex
CREATE INDEX "DailyEvent_companyId_expiresAt_idx" ON "DailyEvent"("companyId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEvent_companyId_eventKey_key" ON "DailyEvent"("companyId", "eventKey");

-- CreateIndex
CREATE INDEX "DailyReaction_userId_idx" ON "DailyReaction"("userId");

-- CreateIndex
CREATE INDEX "AnniversaryReceipt_companyId_recipientId_createdAt_idx" ON "AnniversaryReceipt"("companyId", "recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnniversaryReceipt_companyId_recipientId_subjectId_dateKey_key" ON "AnniversaryReceipt"("companyId", "recipientId", "subjectId", "dateKey");

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTaskAssignee" ADD CONSTRAINT "DailyTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTaskAssignee" ADD CONSTRAINT "DailyTaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTaskComment" ADD CONSTRAINT "DailyTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTaskComment" ADD CONSTRAINT "DailyTaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAnnouncement" ADD CONSTRAINT "DailyAnnouncement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAnnouncement" ADD CONSTRAINT "DailyAnnouncement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEvent" ADD CONSTRAINT "DailyEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEvent" ADD CONSTRAINT "DailyEvent_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEvent" ADD CONSTRAINT "DailyEvent_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "DailyAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReaction" ADD CONSTRAINT "DailyReaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DailyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReaction" ADD CONSTRAINT "DailyReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnniversaryReceipt" ADD CONSTRAINT "AnniversaryReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnniversaryReceipt" ADD CONSTRAINT "AnniversaryReceipt_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnniversaryReceipt" ADD CONSTRAINT "AnniversaryReceipt_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
