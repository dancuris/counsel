-- Adding a required column to a table that already holds rows.
-- Each existing ask becomes a thread of one, keyed on its own id, rather than
-- being deleted or lumped into a shared bucket: they were separate questions.
ALTER TABLE "AskLog" ADD COLUMN "threadId" TEXT;
UPDATE "AskLog" SET "threadId" = "id" WHERE "threadId" IS NULL;
ALTER TABLE "AskLog" ALTER COLUMN "threadId" SET NOT NULL;

CREATE INDEX "AskLog_threadId_createdAt_idx" ON "AskLog"("threadId", "createdAt");
