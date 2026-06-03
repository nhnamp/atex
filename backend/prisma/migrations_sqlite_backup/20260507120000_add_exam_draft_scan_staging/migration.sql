PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "ExamDraftScan" (
	"id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"sessionId" INTEGER NOT NULL,
	"studentId" INTEGER,
	"status" TEXT NOT NULL DEFAULT 'PENDING',
	"frontPageUrl" TEXT NOT NULL,
	"essayPagesUrls" TEXT NOT NULL DEFAULT '[]',
	"omrResult" TEXT,
	"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" DATETIME NOT NULL,
	CONSTRAINT "ExamDraftScan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "ExamDraftScan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
	CONSTRAINT "ExamDraftScan_status_check" CHECK ("status" IN ('PENDING', 'VALID', 'UNIDENTIFIED', 'BLURRY_ERROR'))
);

CREATE INDEX "ExamDraftScan_sessionId_idx" ON "ExamDraftScan"("sessionId");
CREATE INDEX "ExamDraftScan_studentId_idx" ON "ExamDraftScan"("studentId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
