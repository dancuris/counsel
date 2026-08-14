-- CreateTable
CREATE TABLE "FailureLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operation" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "FailureLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailureLog_at_idx" ON "FailureLog"("at");
