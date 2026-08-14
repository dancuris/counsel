-- AlterTable
ALTER TABLE "MailMessage" ADD COLUMN     "proposedLabel" TEXT,
ADD COLUMN     "proposedStart" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3);
