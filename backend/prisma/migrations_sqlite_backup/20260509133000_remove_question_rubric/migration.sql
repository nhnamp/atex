-- Remove per-question essay rubric. AI grading now always uses the default
-- percentage rubric defined in backend/src/services/gemini.service.ts.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Question" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subjectId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "options" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "learningOutcomeId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Question_learningOutcomeId_fkey" FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Question" (
    "id",
    "subjectId",
    "type",
    "content",
    "answer",
    "options",
    "status",
    "difficulty",
    "learningOutcomeId",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "subjectId",
    "type",
    "content",
    "answer",
    "options",
    "status",
    "difficulty",
    "learningOutcomeId",
    "createdAt",
    "updatedAt"
FROM "Question";

DROP TABLE "Question";
ALTER TABLE "new_Question" RENAME TO "Question";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
