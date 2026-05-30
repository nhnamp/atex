PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Exam" (
	"id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	"subjectId" INTEGER NOT NULL,
	"teacherId" INTEGER NOT NULL,
	"title" TEXT NOT NULL,
	"examType" TEXT NOT NULL DEFAULT 'MIDTERM',
	"examDate" DATETIME,
	"durationMinutes" INTEGER NOT NULL DEFAULT 60,
	"status" TEXT NOT NULL DEFAULT 'DRAFT',
	"requirements" TEXT NOT NULL DEFAULT '{}',
	"scannable_pages" INTEGER NOT NULL DEFAULT 1,
	"randomSeed" TEXT,
	"version" INTEGER NOT NULL DEFAULT 1,
	"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" DATETIME NOT NULL,
	CONSTRAINT "Exam_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "Exam_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Exam" (
	"id",
	"subjectId",
	"teacherId",
	"title",
	"examType",
	"examDate",
	"durationMinutes",
	"status",
	"requirements",
	"scannable_pages",
	"randomSeed",
	"version",
	"createdAt",
	"updatedAt"
)
SELECT
	"id",
	"subjectId",
	"teacherId",
	"title",
	"examType",
	"examDate",
	"durationMinutes",
	"status",
	"requirements",
	COALESCE("pageCount", 1),
	"randomSeed",
	"version",
	"createdAt",
	"updatedAt"
FROM "Exam";

DROP TABLE "Exam";
ALTER TABLE "new_Exam" RENAME TO "Exam";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
