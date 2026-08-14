-- AlterTable
ALTER TABLE "MailMessage" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "MailMessage_companyId_idx" ON "MailMessage"("companyId");

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
