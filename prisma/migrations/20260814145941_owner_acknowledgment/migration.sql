-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedVersion" TEXT;
