-- CreateTable
CREATE TABLE "AiUsageCounter" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AiUsageCounter_updatedAt_idx" ON "AiUsageCounter"("updatedAt");
