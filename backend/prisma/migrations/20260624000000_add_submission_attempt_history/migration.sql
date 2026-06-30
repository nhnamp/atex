-- Store every graded paper attempt for a submission while keeping
-- ExamSubmission as the latest/current result shown in reports.
CREATE TABLE "ExamSubmissionAttempt" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "sourceDraftId" INTEGER,
    "scanFiles" TEXT NOT NULL DEFAULT '[]',
    "objectiveAnswers" TEXT NOT NULL DEFAULT '{}',
    "essayAnswers" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'GRADED',
    "aiScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "feedback" TEXT,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSubmissionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamSubmissionAttempt_submissionId_attemptNumber_key" ON "ExamSubmissionAttempt"("submissionId", "attemptNumber");
CREATE INDEX "ExamSubmissionAttempt_submissionId_idx" ON "ExamSubmissionAttempt"("submissionId");
CREATE INDEX "ExamSubmissionAttempt_sourceDraftId_idx" ON "ExamSubmissionAttempt"("sourceDraftId");

ALTER TABLE "ExamSubmissionAttempt" ADD CONSTRAINT "ExamSubmissionAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExamSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
