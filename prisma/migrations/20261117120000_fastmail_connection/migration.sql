-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "sendMailVia" TEXT;

-- CreateTable
CREATE TABLE "FastmailConnection" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "email" TEXT NOT NULL,
    "sealedToken" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "canSend" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FastmailConnection_pkey" PRIMARY KEY ("id")
);
