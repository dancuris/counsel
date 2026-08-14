-- CreateTable
CREATE TABLE "GeneralDocument" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "driveFileIdDocx" TEXT,
    "driveFileIdPdf" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneralDocument_pkey" PRIMARY KEY ("id")
);
