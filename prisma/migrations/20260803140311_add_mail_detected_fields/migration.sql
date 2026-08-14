-- AlterTable
ALTER TABLE "MailMessage" ADD COLUMN     "detectedCompany" TEXT,
ADD COLUMN     "detectedRole" TEXT,
ADD COLUMN     "dismissedAt" TIMESTAMP(3);
