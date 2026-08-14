-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "driveEvalFileId" TEXT,
ADD COLUMN     "driveNotesFileId" TEXT;

-- AlterTable
ALTER TABLE "UploadedFile" ADD COLUMN     "driveFileId" TEXT;
