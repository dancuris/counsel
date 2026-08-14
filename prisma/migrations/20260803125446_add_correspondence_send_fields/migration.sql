-- AlterTable
ALTER TABLE "Correspondence" ADD COLUMN     "gmailMessageId" TEXT,
ADD COLUMN     "gmailThreadId" TEXT,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "subject" TEXT;
