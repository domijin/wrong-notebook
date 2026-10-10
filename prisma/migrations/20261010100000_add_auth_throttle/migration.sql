-- CreateTable
CREATE TABLE "AuthThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" DATETIME,
    "lockedUntil" DATETIME
);

-- CreateIndex
CREATE INDEX "AuthThrottle_lastFailureAt_idx" ON "AuthThrottle"("lastFailureAt");
