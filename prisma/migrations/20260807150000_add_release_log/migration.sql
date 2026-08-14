-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "branch" TEXT,
    "environment" TEXT NOT NULL,
    "deploymentId" TEXT,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Release_sha_environment_key" ON "Release"("sha", "environment");

-- CreateIndex
CREATE INDEX "Release_deployedAt_idx" ON "Release"("deployedAt");
