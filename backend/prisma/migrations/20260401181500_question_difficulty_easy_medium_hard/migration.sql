-- Migrate Question.difficulty from integer scale (1-5) to EASY/MEDIUM/HARD text
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Question" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "subjectId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "options" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "topic" TEXT,
  "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
  "rubric" TEXT,
  "learningOutcomeId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Question_learningOutcomeId_fkey" FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Question" (
  "id", "subjectId", "type", "content", "answer", "options", "status", "topic", "difficulty", "rubric", "learningOutcomeId", "createdAt", "updatedAt"
)
SELECT
  "id",
  "subjectId",
  "type",
  "content",
  "answer",
  "options",
  "status",
  "topic",
  CASE
    WHEN CAST("difficulty" AS INTEGER) <= 2 THEN 'EASY'
    WHEN CAST("difficulty" AS INTEGER) <= 4 THEN 'MEDIUM'
    ELSE 'HARD'
  END,
  "rubric",
  "learningOutcomeId",
  "createdAt",
  "updatedAt"
FROM "Question";

DROP TABLE "Question";
ALTER TABLE "new_Question" RENAME TO "Question";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
