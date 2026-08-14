-- CreateTable
CREATE TABLE "ConsoleRun" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "contextPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsoleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsoleRun_createdAt_idx" ON "ConsoleRun"("createdAt");
