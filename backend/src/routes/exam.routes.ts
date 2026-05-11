import { Router } from 'express';
import {
  cloneExamToDraft,
  cloneExamConfigToDraft,
  completeScanningAndAutoGrade,
  assignDraftScanStudent,
  createSessionMobileScanLink,
  createExamDraft,
  createExamSession,
  deleteExamSession,
  exportExamAnswerKey,
  exportExamDocx,
  exportSessionReportCsv,
  finalizeSessionReport,
  getExamById,
  getMobileScanContext,
  getMyPublishedExamResults,
  getExamPreview,
  listExamDraftScans,
  getSessionIssuesReport,
  getSessionReport,
  getDraftGradingStatus,
  getSessionSubmissions,
  gradeSubmissionWithAI,
  gradeSubmissionWithOmr,
  listExams,
  listTeacherSessions,
  regradeStudentSubmission,
  reorderExamQuestions,
  replaceExamQuestion,
  reviewSubmissionScore,
  updateExamConfiguration,
  updateExamSessionStatus,
  uploadBulkExamScans,
  uploadMissingPages,
  uploadMobileSubmissionScans,
  uploadSubmissionScans,
  startDraftGrading,
  checkDraftsIdentity,
  deleteDraftScan,
  reorderDraftScans,
  reorderDraftScanPages,
  reuploadDraftScanFrontPage,
} from '../controllers/exam.controller';
import { config } from '../config';
import { authenticate, requireApproved, requireRole } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

const scanStoragePath = path.join(process.cwd(), 'uploads', 'scans');
fs.mkdirSync(scanStoragePath, { recursive: true });

const tempScanStoragePath = path.join(process.cwd(), 'uploads', 'temp');
fs.mkdirSync(tempScanStoragePath, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, scanStoragePath),
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
      cb(null, safe);
    },
  }),
});

const tempUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempScanStoragePath),
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
      cb(null, safe);
    },
  }),
});

const mobileScanFileLimit = config.uploadLimits.mobileScanFiles;
const submissionScanFileLimit = config.uploadLimits.submissionScanFiles;
const bulkScanFileLimit = config.uploadLimits.bulkScanFiles;
const missingPageFileLimit = config.uploadLimits.missingPageFiles;

// Mobile scan public endpoints (token-based)
router.get('/mobile-scan/context', getMobileScanContext);
router.post('/mobile-scan/upload', upload.array('files', mobileScanFileLimit), uploadMobileSubmissionScans);

router.use(authenticate, requireApproved);

// Exam builder
router.get('/builder', requireRole('TEACHER'), listExams);
router.post('/builder', requireRole('TEACHER'), createExamDraft);
router.post('/builder/:examId/clone-draft', requireRole('TEACHER'), cloneExamToDraft);
router.post('/builder/:examId/clone-config-draft', requireRole('TEACHER'), cloneExamConfigToDraft);
router.get('/builder/:examId', requireRole('TEACHER'), getExamById);
router.get('/builder/:examId/preview', requireRole('TEACHER'), getExamPreview);
router.patch('/builder/:examId/configuration', requireRole('TEACHER'), updateExamConfiguration);
router.patch('/builder/:examId/reorder', requireRole('TEACHER'), reorderExamQuestions);
router.patch('/builder/:examId/questions/:questionId/replace', requireRole('TEACHER'), replaceExamQuestion);
router.patch('/builder/:examId/questions/:questionId/points', requireRole('TEACHER'), async (req, res, next) => { try { const mod = await import('../controllers/exam.controller'); return mod.updateExamQuestionPoints(req, res); } catch (e) { next(e); } });
router.get('/builder/:examId/export', requireRole('TEACHER'), exportExamDocx);
router.get('/builder/:examId/export-answer-key', requireRole('TEACHER'), exportExamAnswerKey);
router.post('/builder/:examId/sessions', requireRole('TEACHER'), createExamSession);

// Session management
router.get('/sessions', requireRole('TEACHER'), listTeacherSessions);
router.post('/sessions/:sessionId/complete-scanning', requireRole('TEACHER'), completeScanningAndAutoGrade);
router.patch('/sessions/:sessionId/status', requireRole('TEACHER'), updateExamSessionStatus);
router.delete('/sessions/:sessionId', requireRole('TEACHER'), deleteExamSession);
router.get('/sessions/:sessionId/submissions', requireRole('TEACHER'), getSessionSubmissions);
router.get('/sessions/:sessionId/report', requireRole('TEACHER'), getSessionReport);
router.get('/sessions/:sessionId/report/export', requireRole('TEACHER'), exportSessionReportCsv);
router.post('/sessions/:sessionId/report/finalize', requireRole('TEACHER'), finalizeSessionReport);
router.post('/sessions/:sessionId/mobile-scan-link', requireRole('TEACHER'), createSessionMobileScanLink);
router.get('/sessions/:sessionId/issues', requireRole('TEACHER'), getSessionIssuesReport);
router.get('/sessions/:sessionId/grading-status', requireRole('TEACHER'), getDraftGradingStatus);
router.get('/sessions/:sessionId/draft-scans', requireRole('TEACHER'), listExamDraftScans);
router.post('/sessions/:sessionId/draft-scans/check-identity', requireRole('TEACHER'), checkDraftsIdentity);
router.post('/sessions/:sessionId/bulk-upload', requireRole('TEACHER'), tempUpload.array('files', bulkScanFileLimit), uploadBulkExamScans);
router.post('/sessions/:sessionId/start-grading', requireRole('TEACHER'), startDraftGrading);
router.patch('/sessions/:sessionId/draft-scans/reorder', requireRole('TEACHER'), reorderDraftScans);
router.patch('/sessions/:sessionId/draft-scans/:draftId/pages-order', requireRole('TEACHER'), reorderDraftScanPages);
router.patch('/sessions/:sessionId/draft-scans/:draftId/assign-student', requireRole('TEACHER'), assignDraftScanStudent);
router.patch('/sessions/:sessionId/draft-scans/:draftId/front-page', requireRole('TEACHER'), tempUpload.single('file'), reuploadDraftScanFrontPage);
router.delete('/sessions/:sessionId/draft-scans/:draftId', requireRole('TEACHER'), deleteDraftScan);

// Student results (published after report confirmation)
router.get('/results/me', requireRole('STUDENT'), getMyPublishedExamResults);
router.post('/sessions/:sessionId/submissions/scan-upload', requireRole('TEACHER'), upload.array('files', submissionScanFileLimit), uploadSubmissionScans);

// Grading workflow
router.post('/submissions/:submissionId/grade-ai', requireRole('TEACHER'), gradeSubmissionWithAI);
router.post('/submissions/:submissionId/grade-omr', requireRole('TEACHER'), gradeSubmissionWithOmr);
router.post('/submissions/:submissionId/review', requireRole('TEACHER'), reviewSubmissionScore);
router.post('/submissions/:submissionId/regrade', requireRole('TEACHER'), regradeStudentSubmission);
router.post('/submissions/:submissionId/upload-missing', requireRole('TEACHER'), upload.array('files', missingPageFileLimit), uploadMissingPages);

export default router;
