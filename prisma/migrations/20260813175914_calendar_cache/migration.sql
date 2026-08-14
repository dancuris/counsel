-- CreateTable
CREATE TABLE "CalendarEventCache" (
    "uid" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "isFullDay" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventCache_pkey" PRIMARY KEY ("uid")
);

-- CreateIndex
CREATE INDEX "CalendarEventCache_start_idx" ON "CalendarEventCache"("start");
