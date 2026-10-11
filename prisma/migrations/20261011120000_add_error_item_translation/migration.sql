-- CreateTable
CREATE TABLE "ErrorItemTranslation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "errorItemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErrorItemTranslation_errorItemId_fkey" FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorItemTranslation_errorItemId_language_key" ON "ErrorItemTranslation"("errorItemId", "language");
