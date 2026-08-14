-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JobApplication_deletedAt_idx" ON "JobApplication"("deletedAt");
