-- CreateTable
CREATE TABLE "ProvisionedInstance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "recipient" TEXT,
    "sealedToken" TEXT,
    "vercelId" TEXT,
    "deploymentId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvisionedInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvisionedInstance_name_key" ON "ProvisionedInstance"("name");
