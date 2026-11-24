-- CreateTable
CREATE TABLE "DailyEventComment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyEventComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyEventComment_eventId_createdAt_idx" ON "DailyEventComment"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "DailyEventComment" ADD CONSTRAINT "DailyEventComment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DailyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEventComment" ADD CONSTRAINT "DailyEventComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
