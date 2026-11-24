-- CreateTable
CREATE TABLE "assistant_unanswered_questions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "questionMasked" VARCHAR(400) NOT NULL,
    "textKey" VARCHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "adminNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_unanswered_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_unanswered_questions_createdAt_idx" ON "assistant_unanswered_questions"("createdAt");

-- CreateIndex
CREATE INDEX "assistant_unanswered_questions_status_createdAt_idx" ON "assistant_unanswered_questions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_unanswered_questions_textKey_idx" ON "assistant_unanswered_questions"("textKey");

-- CreateIndex
CREATE INDEX "assistant_unanswered_questions_expiresAt_idx" ON "assistant_unanswered_questions"("expiresAt");
