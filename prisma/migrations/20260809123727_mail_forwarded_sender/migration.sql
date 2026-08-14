-- AlterTable
ALTER TABLE "MailMessage" ADD COLUMN     "forwardedFromEmail" TEXT,
ADD COLUMN     "forwardedFromName" TEXT;
