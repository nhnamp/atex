export interface User {
  id: number;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt?: string;
}

export interface Class {
  id: number;
  name: string;
  description?: string;
  teacherId: number;
  teacher?: User;
  createdAt?: string;
  _count?: { students: number; sessions: number };
  students?: { student: User; joinedAt: string }[];
  sessions?: AttendanceSession[];
}

export interface AttendanceSession {
  id: number;
  classId: number;
  class?: Class;
  status: 'ACTIVE' | 'COMPLETED';
  method?: 'CODE' | 'FACE';
  startedAt: string;
  endedAt?: string;
  createdAt?: string;
  _count?: { records: number };
  // Teacher only fields (from status endpoint)
  currentCode?: string;
  codeIndex?: number;
  timeLeft?: number;
  totalCodes?: number;
}

export interface FaceDescriptor {
  id: number;
  studentId: number;
  descriptor: number[];
  createdAt?: string;
}

export interface AttendanceRecord {
  student: User;
  isPresent: boolean;
  codesEntered: Record<string, string>;
  submitted: boolean;
}

export interface Subject {
  id: number;
  name: string;
  teacherId: number;
  teacher?: User;
  createdAt?: string;
  _count?: { questions: number };
}

export interface LearningOutcome {
  id: number;
  subjectId: number;
  code: string;
  description: string;
  createdAt?: string;
  _count?: { questions: number };
}

export interface Question {
  id: number;
  subjectId: number;
  type: 'MULTIPLE_CHOICE' | 'ESSAY';
  content: string;
  answer: string;
  options?: string | null; // JSON string
  status?: 'ACTIVE' | 'ARCHIVED';
  topic?: string | null;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  rubric?: string | null;
  learningOutcomeId?: number | null;
  learningOutcome?: LearningOutcome;
  createdAt?: string;
}

export interface ExamRequirements {
  total: number;
  multipleChoice: number;
  essay: number;
  difficultyDistribution?: {
    multipleChoice: { easy: number; medium: number; hard: number };
    essay: { easy: number; medium: number; hard: number };
  };
  outcomeRatios?: Array<{
    learningOutcomeId: number;
    ratio: number;
  }>;
}

export interface BuiltExam {
  id: number;
  title: string;
  examType: string;
  subjectId: number;
  teacherId: number;
  examDate?: string | null;
  durationMinutes: number;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  requirements: string;
  version: number;
  randomSeed?: string | null;
  createdAt: string;
  subject?: Subject;
  _count?: { questions: number; sessions: number };
  questions?: { position: number; points: number; question: Question }[];
  sessions?: ExamSession[];
}

export interface ExamSession {
  id: number;
  examId: number;
  classId: number;
  status: 'DRAFT' | 'ONGOING' | 'GRADING' | 'COMPLETED';
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  class?: { id: number; name: string };
  exam?: { id: number; title: string };
  _count?: { submissions: number };
}

export interface ExamScanEntry {
  source: 'local' | 'cloudinary' | 'imgbb';
  filename?: string;
  url?: string;
  accessUrl?: string;
  passIndex?: number;
  totalPasses?: number;
  purpose?: string;
  capturedAt?: string;
  mergedPdfUrl?: string;
}

export interface ExamSubmission {
  id: number;
  sessionId: number;
  studentId: number;
  scanFiles?: string;
  scanEntries?: ExamScanEntry[];
  scanCount?: number;
  status: 'SUBMITTED' | 'GRADED' | 'REVIEWED' | 'FINALIZED';
  aiScore?: number | null;
  finalScore?: number | null;
  feedback?: string | null;
  mergedPdfUrl?: string | null;
  objectiveScore?: number | null;
  essayScore?: number | null;
  totalScore?: number | null;
  aiComments?: string | null;
  warnings?: string[];
  submittedAt: string;
  student?: { id: number; username: string; fullName: string };
  grades?: Array<{
    id: number;
    method: 'AI' | 'MANUAL';
    objectiveScore: number;
    essayScore: number;
    totalScore: number;
    createdAt: string;
  }>;
}

export interface StudentPublishedExamResult {
  submissionId: number;
  examId: number;
  examTitle: string;
  examType: string;
  classId: number;
  className: string;
  finalScore: number | null;
  aiScore: number | null;
  status: 'FINALIZED';
  gradedAt?: string | null;
  publishedAt: string;
}

export interface BulkUploadClassificationResult {
  studentId: number;
  studentName: string;
  studentCode: string;
  submissionId: number;
  pagesAssigned: number;
  status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';
  confidence: string;
  warnings: string[];
}

export interface BulkUploadSubmissionGroup {
  groupIndex: number;
  scannablePages: number;
  files: string[];
}

export interface BulkUploadResponse {
  message: string;
  totalImages: number;
  scannablePagesPerSubmission?: number;
  submissionGroups?: BulkUploadSubmissionGroup[];
  matched: number;
  ambiguous: number;
  unmatched: number;
  classifications: BulkUploadClassificationResult[];
  unmatchedFiles: string[];
}

export interface SessionIssue {
  submissionId: number;
  studentId: number;
  studentName: string;
  studentCode: string;
  issueType: 'MISSING_EXAM' | 'INCOMPLETE_PAGES' | 'UNREADABLE_IMAGE' | 'IDENTITY_MISMATCH';
  description: string;
  pagesExpected: number;
  pagesReceived: number;
  missingPages: number[];
  warnings: string[];
}

export interface SessionIssuesReport {
  sessionId: number;
  totalStudents: number;
  studentsWithIssues: number;
  issues: SessionIssue[];
  readyForGrading: number;
  summary: {
    missingExams: number;
    incompletePages: number;
    unreadableImages: number;
    identityMismatches: number;
  };
}

export interface RegradeResponse {
  submissionId: number;
  studentName: string;
  previousScore: number | null;
  newScore: number;
  objectiveScore: number;
  essayScore: number;
  warnings: string[];
  status: 'GRADED' | 'FAILED';
  error?: string;
}
