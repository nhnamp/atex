import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import {
  extractAndGradeSubmissionFromScansBatch,
  getGeminiErrorStatusCode,
  computeMultiStudentBatchSize,
  extractAndGradeMultiStudentBatch,
} from '../services/gemini.service';
import type { MultiStudentBatchInput } from '../services/gemini.service';
import {
  buildExamScanBlueprint,
  ExamScanBlueprint,
  generateAnswerKeyDocx,
  generateEssayExamDocx,
  generateMcqEssayExamDocx,
} from '../services/docx.service';
import { uploadImageToCloudinary, uploadPdfToCloudinary } from '../services/cloudinary.service';
import { mergeImagesToPdfBuffer } from '../services/pdf.service';
import { calibrateOmrTemplate, detectDocumentForOmr, detectMarkedOptions, extractStudentIdentityFromOmr, OmrTemplate } from '../services/omr.service';
import { preprocessScanForAnalysis } from '../services/image-preprocess.service';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const prisma = new PrismaClient();

type ExamRequirements = {
  total: number;
  multipleChoice: number;
  essay: number;
  scannablePages?: number;
  difficultyDistribution?: {
    multipleChoice: { easy: number; medium: number; hard: number };
    essay: { easy: number; medium: number; hard: number };
  };
  outcomeRatios?: Array<{
    learningOutcomeId: number;
    ratio: number;
  }>;
  examFormat?: 'FULL_OBJECTIVE' | 'MIXED';
  objectivePercent?: number;
  essayPercent?: number;
  scanBlueprint?: Partial<ExamScanBlueprint>;
};

type ScanPassPlan = {
  expectedPasses: number;
  hasMcq: boolean;
  essayQuestionIds: number[];
  passPurposeByIndex: Record<number, string>;
};

const toInt = (value: unknown): number => parseInt(String(value), 10);

const parseExamRequirements = (raw: string | null | undefined): Partial<ExamRequirements> => {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Partial<ExamRequirements>;
  } catch {
    return {};
  }
};

const normalizePositiveInt = (value: unknown, fallback: number): number => {
  const normalized = Number.parseInt(String(value), 10);
  if (Number.isFinite(normalized) && normalized > 0) return normalized;
  return fallback;
};

/**
 * Returns true if the exam has any session in ONGOING or GRADING status.
 * Used to block edits to the exam structure once scanning/grading has begun.
 */
const hasActiveSessionsForExam = async (examId: number): Promise<boolean> => {
  const count = await prisma.examSession.count({
    where: {
      examId,
      status: { in: ['ONGOING', 'GRADING'] },
    },
  });
  return count > 0;
};

const normalizeStoredScanBlueprint = (
  rawBlueprint: Partial<ExamScanBlueprint> | undefined,
  fallback: ExamScanBlueprint
): ExamScanBlueprint => {
  if (!rawBlueprint || typeof rawBlueprint !== 'object') {
    return fallback;
  }

  const normalizedScannablePages = normalizePositiveInt(
    rawBlueprint.scannablePages,
    fallback.scannablePages
  );

  return {
    ...fallback,
    ...rawBlueprint,
    version: normalizePositiveInt(rawBlueprint.version, fallback.version),
    hasMcq: typeof rawBlueprint.hasMcq === 'boolean' ? rawBlueprint.hasMcq : fallback.hasMcq,
    scannablePages: normalizedScannablePages,
    passPurposeByIndex: {
      ...fallback.passPurposeByIndex,
      ...(rawBlueprint.passPurposeByIndex || {}),
    },
    identityPlaceholders:
      Array.isArray(rawBlueprint.identityPlaceholders) && rawBlueprint.identityPlaceholders.length > 0
        ? rawBlueprint.identityPlaceholders
        : fallback.identityPlaceholders,
    markerAnchors:
      Array.isArray(rawBlueprint.markerAnchors) && rawBlueprint.markerAnchors.length > 0
        ? rawBlueprint.markerAnchors
        : fallback.markerAnchors,
    omrTemplate: rawBlueprint.omrTemplate || fallback.omrTemplate,
  };
};

const resolveExpectedScannablePages = (
  examScannablePages: unknown,
  passPlan: ScanPassPlan,
  scanBlueprint?: ExamScanBlueprint
): number => {
  void examScannablePages;
  void scanBlueprint;

  const inferredByRule = passPlan.hasMcq
    ? 1 + passPlan.essayQuestionIds.length
    : passPlan.essayQuestionIds.length;

  return inferredByRule > 0 ? inferredByRule : 1;
};

const deleteEmptyDraftExams = async (tx: any, teacherId: number): Promise<void> => {
  const draftExams = await tx.exam.findMany({
    where: { teacherId, status: 'DRAFT' },
    select: { id: true },
  });

  if (draftExams.length === 0) return;

  const draftIds = draftExams.map((item: { id: number }) => item.id);
  const draftIdsWithSessions = await tx.examSession.findMany({
    where: { examId: { in: draftIds } },
    select: { examId: true },
  });
  const protectedIds = new Set(draftIdsWithSessions.map((item: { examId: number }) => item.examId));
  const deletableIds = draftIds.filter((id: number) => !protectedIds.has(id));

  if (deletableIds.length > 0) {
    await tx.exam.deleteMany({ where: { id: { in: deletableIds } } });
  }
};

const sortUploadedScanFiles = (files: Express.Multer.File[]): Express.Multer.File[] => {
  return [...files].sort((left, right) => {
    const leftName = String(left.originalname || left.filename || '');
    const rightName = String(right.originalname || right.filename || '');
    return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
  });
};

const MOBILE_SCAN_SCOPE = 'exam_mobile_scan';

type MobileScanTokenPayload = {
  scope: typeof MOBILE_SCAN_SCOPE;
  teacherId: number;
  sessionId: number;
  iat?: number;
  exp?: number;
};

type HttpError = Error & { statusCode?: number; payload?: unknown };

const createHttpError = (statusCode: number, message: string, payload?: unknown): HttpError => {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  if (payload !== undefined) {
    error.payload = payload;
  }
  return error;
};

const TEACHER_BUSY_MESSAGE = 'Hệ thống đang quá tải, vui lòng đợi 1 phút và thử lại.';
const TEACHER_IDENTITY_MESSAGE = 'Không nhận diện được tên hoặc MSSV, vui lòng kiểm tra lại ảnh trang đầu.';
const TEACHER_QUALITY_MESSAGE = 'Ảnh bài làm bị mờ hoặc thiếu góc, vui lòng chụp lại rõ nét hơn.';

const isIdentityFailureMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('identity')
    || normalized.includes('student code')
    || normalized.includes('student id')
    || normalized.includes('cannot auto-detect student')
    || normalized.includes('unable to resolve student')
    || normalized.includes('cannot confidently match')
    || normalized.includes('mssv')
    || normalized.includes('ho ten')
  );
};

const isQualityFailureMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('hard to read')
    || normalized.includes('blur')
    || normalized.includes('unreadable')
    || normalized.includes('missing corner')
    || normalized.includes('quality')
    || normalized.includes('failed to analyze image')
    || normalized.includes('thiếu góc')
    || normalized.includes('mờ')
  );
};

const mapTeacherFacingErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const statusCode = getGeminiErrorStatusCode(error);
  if (statusCode === 429 || statusCode === 503) {
    return TEACHER_BUSY_MESSAGE;
  }

  const httpError = error as HttpError;
  const payloadCode = String((httpError.payload as { errorCode?: unknown } | undefined)?.errorCode || '').trim().toUpperCase();
  if (payloadCode === 'IDENTITY_FAIL') {
    return TEACHER_IDENTITY_MESSAGE;
  }
  if (payloadCode === 'QUALITY_FAIL') {
    return TEACHER_QUALITY_MESSAGE;
  }

  const errorMessage = String((error as Error)?.message || '');
  if (isIdentityFailureMessage(errorMessage)) {
    return TEACHER_IDENTITY_MESSAGE;
  }
  if (isQualityFailureMessage(errorMessage)) {
    return TEACHER_QUALITY_MESSAGE;
  }

  return fallbackMessage;
};

type ScanEntry = {
  filename?: string;
  url?: string;
  source: 'local' | 'cloudinary' | 'imgbb';
  passIndex?: number;
  totalPasses?: number;
  purpose?: string;
  capturedAt?: string;
  mergedPdfUrl?: string;
};

type ScanEntryWithAccessUrl = ScanEntry & {
  accessUrl?: string;
};

const parseScanEntries = (raw: string): ScanEntry[] => {
  const parsed = JSON.parse(raw || '[]') as unknown[];
  if (!Array.isArray(parsed)) return [];

  const entries: ScanEntry[] = [];
  for (const item of parsed) {
    if (typeof item === 'string') {
      if (item.startsWith('http://') || item.startsWith('https://')) {
        entries.push({ source: 'cloudinary', url: item });
      } else {
        entries.push({ source: 'local', filename: item });
      }
      continue;
    }

    if (item && typeof item === 'object') {
      const obj = item as {
        filename?: string;
        url?: string;
        source?: 'local' | 'cloudinary' | 'imgbb';
        passIndex?: number;
        totalPasses?: number;
        purpose?: string;
        capturedAt?: string;
        mergedPdfUrl?: string;
      };
      if (obj.filename || obj.url) {
        entries.push({
          source: obj.source || (obj.url ? 'cloudinary' : 'local'),
          filename: obj.filename,
          url: obj.url,
          passIndex: Number.isFinite(Number(obj.passIndex)) ? Number(obj.passIndex) : undefined,
          totalPasses: Number.isFinite(Number(obj.totalPasses)) ? Number(obj.totalPasses) : undefined,
          purpose: obj.purpose ? String(obj.purpose) : undefined,
          capturedAt: obj.capturedAt ? String(obj.capturedAt) : undefined,
          mergedPdfUrl: obj.mergedPdfUrl ? String(obj.mergedPdfUrl) : undefined,
        });
      }
    }
  }

  return entries;
};

const toScanAccessUrl = (entry: ScanEntry): string | undefined => {
  if (entry.url) return entry.url;
  if (!entry.filename) return undefined;
  return `/uploads/scans/${encodeURIComponent(entry.filename)}`;
};

const toAccessibleScanEntry = (entry: ScanEntry): ScanEntryWithAccessUrl => ({
  ...entry,
  accessUrl: toScanAccessUrl(entry),
});

const parseAccessibleScanEntries = (raw: string): ScanEntryWithAccessUrl[] => {
  return parseScanEntries(raw).map(toAccessibleScanEntry);
};

type ScanQualityMetrics = {
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  edgeDensity: number;
};

type InvalidScanDetail = {
  fileName: string;
  passIndex?: number;
  reasons: string[];
  metrics: ScanQualityMetrics;
};

const analyzeScanQuality = async (filePath: string): Promise<{ valid: boolean; reasons: string[]; metrics: ScanQualityMetrics }> => {
  const metadata = await sharp(filePath).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);

  const sample = await sharp(filePath)
    .rotate()
    .grayscale()
    .resize({ width: 360, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sampleWidth = Number(sample.info.width || 0);
  const sampleHeight = Number(sample.info.height || 0);
  const data = sample.data;

  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  let edgeTotal = 0;

  const step = 2;
  for (let y = 0; y < sampleHeight; y += step) {
    for (let x = 0; x < sampleWidth; x += step) {
      const idx = y * sampleWidth + x;
      const value = data[idx] || 0;

      sum += value;
      sumSquares += value * value;
      count += 1;

      if (x + step < sampleWidth) {
        edgeTotal += Math.abs(value - (data[idx + step] || 0));
      }
      if (y + step < sampleHeight) {
        edgeTotal += Math.abs(value - (data[idx + step * sampleWidth] || 0));
      }
    }
  }

  const brightness = count > 0 ? sum / count : 0;
  const variance = count > 0 ? Math.max(0, sumSquares / count - brightness * brightness) : 0;
  const contrast = Math.sqrt(variance);
  const edgeDensity = count > 0 ? edgeTotal / count : 0;

  const reasons: string[] = [];

  // Keep thresholds permissive to reduce false negatives while still blocking unreadable scans.
  if (width > 0 && height > 0 && (width < 700 || height < 1000)) {
    reasons.push('resolution too low (minimum 700x1000)');
  }
  if (brightness < 25) {
    reasons.push('image too dark');
  }
  if (brightness > 235) {
    reasons.push('image too bright / glare');
  }
  if (contrast < 18) {
    reasons.push('low contrast, text may be faint');
  }
  if (edgeDensity < 6.5) {
    reasons.push('image appears blurred');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    metrics: {
      width,
      height,
      brightness: Number(brightness.toFixed(2)),
      contrast: Number(contrast.toFixed(2)),
      edgeDensity: Number(edgeDensity.toFixed(2)),
    },
  };
};

const collectInvalidScans = async (files: Express.Multer.File[], basePassIndex?: number): Promise<InvalidScanDetail[]> => {
  const invalid: InvalidScanDetail[] = [];

  for (let idx = 0; idx < files.length; idx += 1) {
    const file = files[idx];
    try {
      const result = await analyzeScanQuality(file.path);
      if (!result.valid) {
        invalid.push({
          fileName: file.originalname || file.filename,
          passIndex: Number.isFinite(Number(basePassIndex)) ? Number(basePassIndex) + idx : idx + 1,
          reasons: result.reasons,
          metrics: result.metrics,
        });
      }
    } catch {
      invalid.push({
        fileName: file.originalname || file.filename,
        passIndex: Number.isFinite(Number(basePassIndex)) ? Number(basePassIndex) + idx : idx + 1,
        reasons: ['failed to analyze image quality'],
        metrics: {
          width: 0,
          height: 0,
          brightness: 0,
          contrast: 0,
          edgeDensity: 0,
        },
      });
    }
  }

  return invalid;
};

const getMergedPdfUrlFromEntries = (scanEntries: ScanEntry[]): string | null => {
  for (const entry of scanEntries) {
    if (entry.mergedPdfUrl) return entry.mergedPdfUrl;
  }
  return null;
};

const signMobileScanToken = (teacherId: number, sessionId: number): string => {
  return jwt.sign(
    {
      scope: MOBILE_SCAN_SCOPE,
      teacherId,
      sessionId,
    },
    config.jwtSecret,
    { expiresIn: '8h' }
  );
};

const verifyMobileScanToken = (token: string): MobileScanTokenPayload => {
  const payload = jwt.verify(token, config.jwtSecret) as MobileScanTokenPayload;
  if (payload.scope !== MOBILE_SCAN_SCOPE || !payload.teacherId || !payload.sessionId) {
    throw createHttpError(401, 'Invalid mobile scan token');
  }
  return payload;
};

type StudentIdentity = {
  id: number;
  username: string;
  fullName: string;
};

const normalizeIdentityText = (value: string | null | undefined): string => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

const normalizeStudentCode = (value: unknown): string => {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
};

const matchesStudentCodePattern = (studentCode: string, candidatePattern: string): boolean => {
  if (!candidatePattern || candidatePattern.length !== studentCode.length) {
    return false;
  }

  for (let index = 0; index < candidatePattern.length; index += 1) {
    const expectedChar = candidatePattern[index];
    if (expectedChar === '?') continue;
    if (expectedChar !== studentCode[index]) return false;
  }

  return true;
};

const resolveStudentFromIdentity = (
  students: StudentIdentity[],
  identity: { studentCode: string | null; fullName: string | null }
): { matched: StudentIdentity | null; ambiguous: StudentIdentity[] } => {
  const normalizedCode = normalizeStudentCode(identity.studentCode);
  const normalizedName = normalizeIdentityText(identity.fullName);

  if (normalizedCode) {
    const codeMatches = students.filter((student) => {
      const studentCode = normalizeStudentCode(student.username);
      return studentCode === normalizedCode || matchesStudentCodePattern(studentCode, normalizedCode);
    });
    if (codeMatches.length === 1) {
      return { matched: codeMatches[0], ambiguous: [] };
    }
    if (codeMatches.length > 1) {
      return { matched: null, ambiguous: codeMatches };
    }
  }

  if (normalizedName) {
    const exactNameMatches = students.filter((student) => normalizeIdentityText(student.fullName) === normalizedName);
    if (exactNameMatches.length === 1) {
      return { matched: exactNameMatches[0], ambiguous: [] };
    }
    if (exactNameMatches.length > 1) {
      return { matched: null, ambiguous: exactNameMatches };
    }

    const fuzzyNameMatches = students.filter((student) => {
      const normalizedStudentName = normalizeIdentityText(student.fullName);
      return normalizedStudentName.includes(normalizedName) || normalizedName.includes(normalizedStudentName);
    });

    if (fuzzyNameMatches.length === 1) {
      return { matched: fuzzyNameMatches[0], ambiguous: [] };
    }
    if (fuzzyNameMatches.length > 1) {
      return { matched: null, ambiguous: fuzzyNameMatches };
    }
  }

  return { matched: null, ambiguous: [] };
};

const ensureSessionSubmissionRows = async (sessionId: number, classId: number): Promise<void> => {
  const enrolledStudents = await prisma.classStudent.findMany({
    where: { classId },
    select: { studentId: true },
  });

  if (enrolledStudents.length === 0) {
    return;
  }

  const existingSubmissions = await prisma.examSubmission.findMany({
    where: { sessionId },
    select: { studentId: true },
  });

  const existingStudentIds = new Set(existingSubmissions.map((item) => item.studentId));
  const missingStudentIds = enrolledStudents
    .map((item) => item.studentId)
    .filter((studentId) => !existingStudentIds.has(studentId));

  if (missingStudentIds.length > 0) {
    await prisma.examSubmission.createMany({
      data: missingStudentIds.map((studentId) => ({
        sessionId,
        studentId,
        scanFiles: '[]',
        objectiveAnswers: '{}',
        essayAnswers: '{}',
        status: 'SUBMITTED',
      })),
    });
  }
};

const buildFallbackScanBlueprintFromQuestions = (
  examQuestions: Array<{ question: { id: number; type: string } }>
): ExamScanBlueprint => {
  const mcqQuestions = examQuestions
    .filter((item) => item.question.type === 'MULTIPLE_CHOICE')
    .map((item) => ({
      id: item.question.id,
      type: 'MULTIPLE_CHOICE',
      content: '',
      answer: '',
      options: null,
    }));

  const essayQuestions = examQuestions
    .filter((item) => item.question.type === 'ESSAY')
    .map((item) => ({
      id: item.question.id,
      type: 'ESSAY',
      content: '',
      answer: '',
      options: null,
    }));

  return buildExamScanBlueprint(mcqQuestions, essayQuestions);
};

const resolveExamScanBlueprint = (
  examQuestions: Array<{ question: { id: number; type: string } }>,
  rawRequirements: string | null | undefined
): ExamScanBlueprint => {
  const parsedRequirements = parseExamRequirements(rawRequirements);
  const fallbackBlueprint = buildFallbackScanBlueprintFromQuestions(examQuestions);
  return normalizeStoredScanBlueprint(parsedRequirements.scanBlueprint, fallbackBlueprint);
};

const getMaxPassFromAnchors = (scanBlueprint?: ExamScanBlueprint): number => {
  const anchors = Array.isArray(scanBlueprint?.markerAnchors) ? scanBlueprint!.markerAnchors : [];
  let maxPass = 0;

  for (const anchor of anchors) {
    const passIndex = normalizePositiveInt(anchor?.passIndex, 0);
    const pageIndex = normalizePositiveInt(anchor?.pageIndex, 0);
    maxPass = Math.max(maxPass, passIndex, pageIndex);
  }

  return maxPass;
};

const getMaxPurposeDrivenPass = (scanBlueprint?: ExamScanBlueprint): number => {
  const purposes = scanBlueprint?.passPurposeByIndex || {};
  let maxPass = 0;

  for (const [rawIndex, rawPurpose] of Object.entries(purposes)) {
    const index = normalizePositiveInt(rawIndex, 0);
    if (!index) continue;

    const purpose = String(rawPurpose || '').trim();
    if (!purpose) continue;

    // Ignore placeholder PAGE_n purposes when estimating real page count.
    if (purpose.toUpperCase() === `PAGE_${index}`) continue;

    maxPass = Math.max(maxPass, index);
  }

  return maxPass;
};

const buildScanPassPlan = (
  examQuestions: Array<{ question: { id: number; type: string } }>,
  scanBlueprint?: ExamScanBlueprint
): ScanPassPlan => {
  const essayQuestionIds = examQuestions
    .filter((item) => item.question.type === 'ESSAY')
    .map((item) => item.question.id);
  const hasMcq = examQuestions.some((item) => item.question.type === 'MULTIPLE_CHOICE');

  const inferredPasses = hasMcq ? essayQuestionIds.length + 1 : essayQuestionIds.length;

  const expectedPasses = inferredPasses > 0 ? inferredPasses : 1;

  const passPurposeByIndex: Record<number, string> = {};
  const rawMap = scanBlueprint?.passPurposeByIndex || {};
  for (const [rawIndex, purpose] of Object.entries(rawMap)) {
    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(index) || index < 1 || index > expectedPasses) continue;
    const normalizedPurpose = String(purpose || '').trim();
    if (!normalizedPurpose) continue;
    passPurposeByIndex[index] = normalizedPurpose;
  }

  for (let passIndex = 1; passIndex <= expectedPasses; passIndex += 1) {
    if (passPurposeByIndex[passIndex]) continue;

    if (essayQuestionIds.length === 0) {
      passPurposeByIndex[passIndex] = 'IDENTITY_OMR';
      continue;
    }

    if (hasMcq) {
      if (passIndex === 1) {
        passPurposeByIndex[passIndex] = 'IDENTITY_OMR';
      } else {
        const essayId = essayQuestionIds[passIndex - 2];
        passPurposeByIndex[passIndex] = essayId ? `ESSAY_${essayId}` : `PAGE_${passIndex}`;
      }
      continue;
    }

    const essayId = essayQuestionIds[passIndex - 1];
    passPurposeByIndex[passIndex] = essayId ? `IDENTITY_ESSAY_${essayId}` : `PAGE_${passIndex}`;
  }

  return { expectedPasses, hasMcq, essayQuestionIds, passPurposeByIndex };
};

const getScanPassPurpose = (passIndex: number, passPlan: ScanPassPlan): string => {
  return passPlan.passPurposeByIndex[passIndex] || `PAGE_${passIndex}`;
};

const persistSubmissionScans = async (params: {
  sessionId: number;
  studentId: number;
  files: Express.Multer.File[];
  passIndex?: number;
  totalPasses?: number;
  purpose?: string;
  replaceExisting?: boolean;
  sequentialPasses?: boolean;
  passPurposeResolver?: (passIndex: number) => string;
}) => {
  const {
    sessionId,
    studentId,
    files,
    passIndex,
    totalPasses,
    purpose,
    replaceExisting,
    sequentialPasses,
    passPurposeResolver,
  } = params;

  if (files.length === 0) {
    throw createHttpError(400, 'At least one scan file is required');
  }

  const scanEntries: ScanEntry[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file.mimetype?.startsWith('image/')) {
      throw createHttpError(400, `Unsupported file type for scan upload: ${file.originalname || file.filename}`);
    }

    const resolvedPassIndex = sequentialPasses ? index + 1 : passIndex;
    const resolvedPurpose =
      Number.isFinite(Number(resolvedPassIndex)) && passPurposeResolver
        ? passPurposeResolver(Number(resolvedPassIndex))
        : purpose;

    let uploadedUrl = '';
    try {
      const fileBuffer = fs.readFileSync(file.path);
      uploadedUrl = await uploadImageToCloudinary(fileBuffer, file.originalname || file.filename);
    } catch {
      throw createHttpError(502, `Failed to upload ${file.originalname || file.filename} to Cloudinary. Please retry scan capture.`);
    } finally {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    scanEntries.push({
      source: 'cloudinary',
      filename: file.filename,
      url: uploadedUrl,
      passIndex: resolvedPassIndex,
      totalPasses,
      purpose: resolvedPurpose,
      capturedAt: new Date().toISOString(),
    });
  }

  const existingSubmission = await prisma.examSubmission.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
    select: { scanFiles: true },
  });
  const existingScans = replaceExisting ? [] : existingSubmission ? parseScanEntries(existingSubmission.scanFiles || '[]') : [];
  let mergedScans = [...existingScans, ...scanEntries];

  // Keep one latest image per pass index so teachers can re-upload a single bad page.
  if (!replaceExisting) {
    const byPass = new Map<number, ScanEntry>();
    const withoutPass: ScanEntry[] = [];

    for (const entry of mergedScans) {
      const idx = Number(entry.passIndex);
      if (Number.isFinite(idx) && idx > 0) {
        byPass.set(idx, entry);
      } else {
        withoutPass.push(entry);
      }
    }

    mergedScans = [
      ...withoutPass,
      ...Array.from(byPass.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, entry]) => entry),
    ];
  }

  const normalizedTotalPasses = Number.isFinite(Number(totalPasses)) && Number(totalPasses) > 0
    ? Number(totalPasses)
    : 0;

  const scansWithPass = mergedScans
    .filter((entry) => Number.isFinite(Number(entry.passIndex)) && Number(entry.passIndex) > 0)
    .sort((a, b) => Number(a.passIndex) - Number(b.passIndex));

  const uniquePasses = new Set(scansWithPass.map((entry) => Number(entry.passIndex)));
  const hasCompleteSet =
    normalizedTotalPasses > 0
    && uniquePasses.size === normalizedTotalPasses
    && Array.from(uniquePasses).every((idx) => idx >= 1 && idx <= normalizedTotalPasses);

  if (hasCompleteSet) {
    const temporaryPaths: string[] = [];
    try {
      const orderedPaths: string[] = [];
      for (const scan of scansWithPass) {
        const resolvedPath = await resolveScanPath(scan);
        orderedPaths.push(resolvedPath);
        if (path.basename(resolvedPath).startsWith('scan_tmp_')) {
          temporaryPaths.push(resolvedPath);
        }
      }

      const mergedPdfBuffer = await mergeImagesToPdfBuffer(orderedPaths);
      const mergedPdfUrl = await uploadPdfToCloudinary(
        mergedPdfBuffer,
        `session_${sessionId}_student_${studentId}_merged.pdf`
      );

      mergedScans = mergedScans.map((entry) => ({
        ...entry,
        mergedPdfUrl,
      }));
    } catch {
      throw createHttpError(502, 'Failed to generate/upload merged PDF from submitted scan pages. Please retry upload.');
    } finally {
      for (const tempPath of temporaryPaths) {
        if (fs.existsSync(tempPath)) {
          fs.unlink(tempPath, () => undefined);
        }
      }
    }
  } else {
    mergedScans = mergedScans.map((entry) => {
      if (!entry.mergedPdfUrl) return entry;
      const cleaned = { ...entry };
      delete cleaned.mergedPdfUrl;
      return cleaned;
    });
  }

  const submission = await prisma.examSubmission.upsert({
    where: { sessionId_studentId: { sessionId, studentId } },
    create: {
      sessionId,
      studentId,
      scanFiles: JSON.stringify(mergedScans),
      status: 'SUBMITTED',
    },
    update: {
      scanFiles: JSON.stringify(mergedScans),
      status: 'SUBMITTED',
    },
  });

  return {
    submission,
    mergedScans,
    mergedPdfUrl: getMergedPdfUrlFromEntries(mergedScans),
  };
};

const resolveScanPath = async (entry: ScanEntry): Promise<string> => {
  if (entry.filename) {
    const localPath = path.join(process.cwd(), 'uploads', 'scans', entry.filename);
    if (fs.existsSync(localPath)) {
      return localPath;
    }

    if (!entry.url) {
      throw new Error(`Scan file missing on server: ${entry.filename}`);
    }
  }

  if (!entry.url) {
    throw new Error('Scan entry has no filename or url');
  }

  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`Failed to download scan from ${entry.url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tempName = `scan_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const tempPath = path.join(process.cwd(), 'uploads', 'scans', tempName);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
};

const parseAnswerMap = (raw: string | null | undefined): Record<string, string> => {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
      const normalizedKey = String(key).replace(/[^0-9]/g, '');
      if (!normalizedKey) return acc;
      acc[normalizedKey] = String(value || '').trim();
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const extractSubmissionReportDetails = (submission: { feedback?: string | null; scanFiles?: string | null }) => {
  let parsed: {
    objectiveScore?: unknown;
    essayScore?: unknown;
    totalScore?: unknown;
    aiComments?: unknown;
    mergedPdfUrl?: unknown;
    warnings?: unknown;
  } = {};

  try {
    parsed = JSON.parse(submission.feedback || '{}') as typeof parsed;
  } catch {
    parsed = {};
  }

  const fallbackMergedPdfUrl = getMergedPdfUrlFromEntries(parseScanEntries(submission.scanFiles || '[]'));

  const toNumberOrNull = (value: unknown): number | null => {
    const parsedNumber = Number(value);
    return Number.isFinite(parsedNumber) ? parsedNumber : null;
  };

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    objectiveScore: toNumberOrNull(parsed.objectiveScore),
    essayScore: toNumberOrNull(parsed.essayScore),
    totalScore: toNumberOrNull(parsed.totalScore),
    aiComments: parsed.aiComments ? String(parsed.aiComments) : null,
    mergedPdfUrl: parsed.mergedPdfUrl ? String(parsed.mergedPdfUrl) : fallbackMergedPdfUrl,
    warnings,
  };
};

const normalizeObjectiveAnswers = (answers: Record<string, string>): Record<string, string> => {
  return Object.entries(answers).reduce<Record<string, string>>((acc, [questionId, answer]) => {
    const key = String(questionId).replace(/[^0-9]/g, '');
    if (!key) return acc;
    const value = String(answer || '').trim().toUpperCase().replace(/[^A-D]/g, '');
    if (value) acc[key] = value;
    return acc;
  }, {});
};

const normalizeEssayAnswers = (answers: Record<string, string>): Record<string, string> => {
  return Object.entries(answers).reduce<Record<string, string>>((acc, [questionId, answer]) => {
    const key = String(questionId).replace(/[^0-9]/g, '');
    if (!key) return acc;
    const value = String(answer || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (value) acc[key] = value;
    return acc;
  }, {});
};

type SubmissionExamQuestion = {
  points: number;
  question: {
    id: number;
    type: string;
    content: string;
    answer: string;
    rubric?: string | null;
  };
};

type BatchScanGradingData = {
  objectiveAnswers: Record<string, string>;
  essayAnswers: Record<string, string>;
  essayResults: Array<{ questionId: number; score: number; maxScore: number; feedback: string }>;
  warnings: string[];
  extractedIdentity: { fullName: string | null; studentCode: string | null };
};

const extractBatchScanGradingData = async (
  scanEntries: ScanEntry[],
  examQuestions: SubmissionExamQuestion[],
  scanBlueprint?: ExamScanBlueprint
): Promise<BatchScanGradingData> => {
  const orderedScans = [...scanEntries].sort((a, b) => {
    const aIndex = Number.isFinite(Number(a.passIndex)) ? Number(a.passIndex) : Number.MAX_SAFE_INTEGER;
    const bIndex = Number.isFinite(Number(b.passIndex)) ? Number(b.passIndex) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });

  if (orderedScans.length === 0) {
    throw createHttpError(400, 'No scan files found. Please upload scans before AI grading.');
  }

  const scanPaths: string[] = [];
  const temporaryPaths: string[] = [];

  try {
    for (const entry of orderedScans) {
      const resolvedPath = await resolveScanPath(entry);
      scanPaths.push(resolvedPath);
      if (path.basename(resolvedPath).startsWith('scan_tmp_')) {
        temporaryPaths.push(resolvedPath);
      }
    }

    const mcqQuestions = examQuestions
      .filter((item) => item.question.type === 'MULTIPLE_CHOICE')
      .map((item) => ({
        questionId: item.question.id,
        expectedAnswer: item.question.answer,
        maxScore: item.points,
      }));

    const essayQuestions = examQuestions
      .filter((item) => item.question.type === 'ESSAY')
      .map((item) => ({
        questionId: item.question.id,
        questionContent: item.question.content,
        expectedAnswer: item.question.answer,
        rubric: item.question.rubric,
        maxScore: item.points,
      }));

    const normalizedScannablePages = normalizePositiveInt(
      scanBlueprint?.scannablePages,
      scanPaths.length > 0 ? scanPaths.length : 1
    );
    const gradingScanPaths = scanPaths.slice(0, normalizedScannablePages);
    const preWarnings: string[] = [];
    if (scanPaths.length > normalizedScannablePages) {
      preWarnings.push(
        `Detected ${scanPaths.length} uploaded pages but only the first ${normalizedScannablePages} scannable pages were used for grading.`
      );
    }

    let objectiveAnswers: Record<string, string> = {};
    const omrWarnings: string[] = [];

    if (mcqQuestions.length > 0) {
      const firstScannablePath = gradingScanPaths[0];
      if (!firstScannablePath) {
        throw createHttpError(422, TEACHER_QUALITY_MESSAGE, {
          errorCode: 'QUALITY_FAIL',
        });
      }

      if (!scanBlueprint?.omrTemplate || !Array.isArray(scanBlueprint.omrTemplate.questions) || scanBlueprint.omrTemplate.questions.length === 0) {
        omrWarnings.push('OMR template is missing from exam blueprint; objective answers could not be extracted locally.');
      } else {
        const preprocessedOmr = await preprocessScanForAnalysis(firstScannablePath);
        try {
          const detection = await detectDocumentForOmr(preprocessedOmr.processedPath);
          const calibratedTemplate = calibrateOmrTemplate(scanBlueprint.omrTemplate as OmrTemplate, detection);
          objectiveAnswers = normalizeObjectiveAnswers(
            await detectMarkedOptions(preprocessedOmr.processedPath, calibratedTemplate)
          );

          omrWarnings.push(...detection.warnings, ...preprocessedOmr.warnings);
          if (!detection.ready) {
            omrWarnings.push('OMR first-page detection confidence is low.');
          }
          if (Object.keys(objectiveAnswers).length === 0) {
            omrWarnings.push('No objective answers extracted by local OMR on the first page.');
          }
        } catch (error) {
          throw createHttpError(422, TEACHER_QUALITY_MESSAGE, {
            errorCode: 'QUALITY_FAIL',
            technicalMessage: (error as Error).message,
          });
        } finally {
          preprocessedOmr.cleanup();
        }
      }
    }

    const batchResult = await extractAndGradeSubmissionFromScansBatch({
      scanPaths: gradingScanPaths,
      scannablePages: normalizedScannablePages,
      layoutBlueprint: scanBlueprint,
      passPurposeByIndex: scanBlueprint?.passPurposeByIndex || {},
      essayQuestions,
    });

    const extractedIdentity = {
      fullName: batchResult.fullName,
      studentCode: batchResult.studentCode,
    };

    if (!normalizeStudentCode(extractedIdentity.studentCode) && !normalizeIdentityText(extractedIdentity.fullName)) {
      throw createHttpError(422, TEACHER_IDENTITY_MESSAGE, {
        errorCode: 'IDENTITY_FAIL',
      });
    }

    const essayAnswers = normalizeEssayAnswers(batchResult.essayAnswers || {});
    const warnings = [
      ...new Set(
        [...preWarnings, ...omrWarnings, ...(batchResult.warnings || [])]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      ),
    ];

    if (Object.keys(objectiveAnswers).length === 0 && Object.keys(essayAnswers).length === 0 && warnings.some((warning) => isQualityFailureMessage(warning))) {
      throw createHttpError(422, TEACHER_QUALITY_MESSAGE, {
        errorCode: 'QUALITY_FAIL',
        warnings,
      });
    }

    const essayResultByQuestion = new Map<number, { questionId: number; score: number; maxScore: number; feedback: string }>();
    for (const item of batchResult.essayResults || []) {
      const questionId = Number.parseInt(String(item.questionId), 10);
      if (!Number.isFinite(questionId)) continue;
      essayResultByQuestion.set(questionId, {
        questionId,
        score: Number(item.score) || 0,
        maxScore: Number(item.maxScore) || 0,
        feedback: String(item.feedback || '').trim(),
      });
    }

    for (const essayQuestion of essayQuestions) {
      if (!essayResultByQuestion.has(essayQuestion.questionId)) {
        essayResultByQuestion.set(essayQuestion.questionId, {
          questionId: essayQuestion.questionId,
          score: 0,
          maxScore: Number(essayQuestion.maxScore) || 0,
          feedback: 'Không trích xuất được nội dung tự luận rõ ràng từ ảnh bài làm.',
        });
      }
    }

    const essayResults = Array.from(essayResultByQuestion.values())
      .map((item) => {
        const maxScore = Math.max(0, Number(item.maxScore) || 0);
        const score = Math.max(0, Math.min(maxScore, Number(item.score) || 0));
        return {
          questionId: item.questionId,
          score: Number(score.toFixed(2)),
          maxScore: Number(maxScore.toFixed(2)),
          feedback: String(item.feedback || '').trim().slice(0, 1000),
        };
      })
      .sort((a, b) => a.questionId - b.questionId);

    return {
      objectiveAnswers,
      essayAnswers,
      essayResults,
      warnings,
      extractedIdentity,
    };
  } finally {
    for (const tempPath of temporaryPaths) {
      if (fs.existsSync(tempPath)) {
        fs.unlink(tempPath, () => undefined);
      }
    }
  }
};

const validateRequirements = (requirements: ExamRequirements): string | null => {
  const { total, multipleChoice, essay } = requirements;
  if (!Number.isFinite(total) || total <= 0) return 'total must be a positive number';
  if (!Number.isFinite(multipleChoice) || multipleChoice < 0) return 'multipleChoice must be >= 0';
  if (!Number.isFinite(essay) || essay < 0) return 'essay must be >= 0';
  if (multipleChoice + essay !== total) {
    return 'Sum of question types must equal total';
  }
  if (requirements.difficultyDistribution) {
    const mc = requirements.difficultyDistribution.multipleChoice;
    const essayDist = requirements.difficultyDistribution.essay;

    if (!mc || !essayDist) {
      return 'difficultyDistribution must include multipleChoice and essay ratios';
    }

    const sumMc = Number(mc.easy) + Number(mc.medium) + Number(mc.hard);
    const sumEssay = Number(essayDist.easy) + Number(essayDist.medium) + Number(essayDist.hard);

    if (!Number.isFinite(sumMc) || !Number.isFinite(sumEssay)) {
      return 'Difficulty ratio values must be valid numbers';
    }

    if (multipleChoice > 0 && sumMc !== 100) {
      return 'Difficulty ratio for multipleChoice must sum to 100% when multipleChoice > 0';
    }

    if (essay > 0 && sumEssay !== 100) {
      return 'Difficulty ratio for essay must sum to 100% when essay > 0';
    }
  }

  if (requirements.outcomeRatios && requirements.outcomeRatios.length > 0) {
    const invalid = requirements.outcomeRatios.find(
      (item) =>
        !Number.isFinite(item.learningOutcomeId)
        || item.learningOutcomeId <= 0
        || !Number.isFinite(item.ratio)
        || item.ratio < 0
    );

    if (invalid) {
      return 'Each outcome ratio must include valid learningOutcomeId and ratio >= 0';
    }

    const ratioSum = requirements.outcomeRatios.reduce((acc, item) => acc + item.ratio, 0);
    if (ratioSum <= 0) {
      return 'Outcome ratios must sum to a value greater than 0';
    }
  }
  return null;
};

const seededShuffle = <T>(array: T[], seed: string): T[] => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }

  const random = () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };

  const cloned = [...array];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
};

type QuestionPoolItem = {
  id: number;
  type: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  learningOutcomeId: number | null;
  content?: string;
  answer?: string;
  options?: string | null;
};

type RatioTriple = { easy: number; medium: number; hard: number };

const defaultRatios: RatioTriple = { easy: 50, medium: 35, hard: 15 };

const normalizeDifficultyLabel = (difficulty: string): 'EASY' | 'MEDIUM' | 'HARD' => {
  const normalized = String(difficulty || 'MEDIUM').toUpperCase();
  if (normalized === 'EASY' || normalized === 'MEDIUM' || normalized === 'HARD') {
    return normalized;
  }
  return 'MEDIUM';
};

const buildDifficultyTargets = (count: number, ratios: RatioTriple): Record<'EASY' | 'MEDIUM' | 'HARD', number> => {
  if (count <= 0) return { EASY: 0, MEDIUM: 0, HARD: 0 };

  const raw = [
    { key: 'EASY' as const, value: (count * ratios.easy) / 100 },
    { key: 'MEDIUM' as const, value: (count * ratios.medium) / 100 },
    { key: 'HARD' as const, value: (count * ratios.hard) / 100 },
  ];

  const base = raw.map((item) => ({ key: item.key, value: Math.floor(item.value), frac: item.value - Math.floor(item.value) }));
  let current = base.reduce((acc, item) => acc + item.value, 0);

  base.sort((a, b) => b.frac - a.frac);
  let index = 0;
  while (current < count) {
    base[index % base.length].value += 1;
    current += 1;
    index += 1;
  }

  return {
    EASY: base.find((x) => x.key === 'EASY')?.value ?? 0,
    MEDIUM: base.find((x) => x.key === 'MEDIUM')?.value ?? 0,
    HARD: base.find((x) => x.key === 'HARD')?.value ?? 0,
  };
};

const pickByDifficultyRatio = (
  pool: QuestionPoolItem[],
  count: number,
  ratios: RatioTriple,
  seed: string
): QuestionPoolItem[] => {
  if (count === 0) return [];
  const targets = buildDifficultyTargets(count, ratios);

  const grouped = {
    EASY: seededShuffle(pool.filter((q) => q.difficulty === 'EASY'), `${seed}:easy`),
    MEDIUM: seededShuffle(pool.filter((q) => q.difficulty === 'MEDIUM'), `${seed}:medium`),
    HARD: seededShuffle(pool.filter((q) => q.difficulty === 'HARD'), `${seed}:hard`),
  };

  const selected: QuestionPoolItem[] = [];
  for (const key of ['EASY', 'MEDIUM', 'HARD'] as const) {
    selected.push(...grouped[key].slice(0, targets[key]));
  }

  if (selected.length < count) {
    const selectedIds = new Set(selected.map((item) => item.id));
    const remain = seededShuffle(pool.filter((item) => !selectedIds.has(item.id)), `${seed}:remain`);
    selected.push(...remain.slice(0, count - selected.length));
  }

  if (selected.length < count) {
    throw new Error(`Not enough questions to satisfy requested count ${count}`);
  }

  return selected.slice(0, count);
};

type OutcomeRatio = { learningOutcomeId: number; ratio: number };

const buildRatioTargets = (count: number, ratios: OutcomeRatio[]): Record<number, number> => {
  if (count <= 0 || ratios.length === 0) return {};

  const totalRatio = ratios.reduce((acc, item) => acc + item.ratio, 0);
  if (totalRatio <= 0) return {};

  const raw = ratios.map((item) => {
    const value = (count * item.ratio) / totalRatio;
    const base = Math.floor(value);
    return {
      learningOutcomeId: item.learningOutcomeId,
      value: base,
      fraction: value - base,
    };
  });

  let assigned = raw.reduce((acc, item) => acc + item.value, 0);
  raw.sort((a, b) => b.fraction - a.fraction);
  let index = 0;
  while (assigned < count && raw.length > 0) {
    raw[index % raw.length].value += 1;
    assigned += 1;
    index += 1;
  }

  return raw.reduce<Record<number, number>>((acc, item) => {
    acc[item.learningOutcomeId] = item.value;
    return acc;
  }, {});
};

const resolveOutcomeRatios = (
  requirements: ExamRequirements,
  availableOutcomeIds: number[]
): OutcomeRatio[] => {
  if (availableOutcomeIds.length === 0) return [];

  const uniqueOutcomeIds = [...new Set(availableOutcomeIds)].sort((a, b) => a - b);
  const incoming = requirements.outcomeRatios || [];

  if (!incoming.length) {
    return uniqueOutcomeIds.map((learningOutcomeId) => ({
      learningOutcomeId,
      ratio: 1,
    }));
  }

  const selected = incoming
    .filter((item) => item.ratio > 0 && uniqueOutcomeIds.includes(item.learningOutcomeId))
    .map((item) => ({ learningOutcomeId: item.learningOutcomeId, ratio: item.ratio }));

  if (selected.length === 0) {
    return uniqueOutcomeIds.map((learningOutcomeId) => ({
      learningOutcomeId,
      ratio: 1,
    }));
  }

  return selected;
};

const pickByOutcomeRatioAndDifficulty = (
  pool: QuestionPoolItem[],
  count: number,
  difficultyRatios: RatioTriple,
  outcomeRatios: OutcomeRatio[],
  seed: string
): QuestionPoolItem[] => {
  if (count === 0) return [];
  if (outcomeRatios.length === 0) {
    return pickByDifficultyRatio(pool, count, difficultyRatios, `${seed}:no-outcome`);
  }

  const targets = buildRatioTargets(count, outcomeRatios);
  const selected: QuestionPoolItem[] = [];
  const used = new Set<number>();

  for (const outcome of outcomeRatios) {
    const target = targets[outcome.learningOutcomeId] || 0;
    if (target <= 0) continue;

    const outcomePool = pool.filter(
      (item) => item.learningOutcomeId === outcome.learningOutcomeId && !used.has(item.id)
    );
    if (outcomePool.length === 0) continue;

    const pickCount = Math.min(target, outcomePool.length);
    const picked = pickByDifficultyRatio(outcomePool, pickCount, difficultyRatios, `${seed}:outcome:${outcome.learningOutcomeId}`);
    for (const item of picked) {
      used.add(item.id);
      selected.push(item);
    }
  }

  if (selected.length < count) {
    const remainingPool = pool.filter((item) => !used.has(item.id));
    const remaining = pickByDifficultyRatio(
      remainingPool,
      count - selected.length,
      difficultyRatios,
      `${seed}:remaining`
    );
    selected.push(...remaining);
  }

  if (selected.length < count) {
    throw new Error(`Not enough questions to satisfy requested count ${count}`);
  }

  return selected.slice(0, count);
};

const pickQuestionsByRequirements = (
  allQuestions: QuestionPoolItem[],
  requirements: ExamRequirements,
  randomSeed: string
) => {
  const ratios = requirements.difficultyDistribution
    && requirements.difficultyDistribution.multipleChoice
    && requirements.difficultyDistribution.essay
    ? requirements.difficultyDistribution
    : {
      multipleChoice: defaultRatios,
      essay: defaultRatios,
    };

  const filteredPool = allQuestions;

  const mc = filteredPool.filter((q) => q.type === 'MULTIPLE_CHOICE');
  const essay = filteredPool.filter((q) => q.type === 'ESSAY');
  const availableOutcomeIds = filteredPool
    .map((item) => item.learningOutcomeId)
    .filter((value): value is number => Number.isFinite(value) && value !== null);
  const outcomeRatios = resolveOutcomeRatios(requirements, availableOutcomeIds);

  if (mc.length < requirements.multipleChoice) {
    throw new Error(`Not enough MULTIPLE_CHOICE questions (need ${requirements.multipleChoice}, have ${mc.length})`);
  }
  if (essay.length < requirements.essay) {
    throw new Error(`Not enough ESSAY questions (need ${requirements.essay}, have ${essay.length})`);
  }
  const mcSelected = pickByOutcomeRatioAndDifficulty(
    mc,
    requirements.multipleChoice,
    ratios.multipleChoice,
    outcomeRatios,
    `${randomSeed}:mc`
  );
  const essaySelected = pickByOutcomeRatioAndDifficulty(
    essay,
    requirements.essay,
    ratios.essay,
    outcomeRatios,
    `${randomSeed}:essay`
  );

  // Shuffle within each section but keep sections separated (MCQ first, then Essay)
  const mcShuffled = seededShuffle(mcSelected, `${randomSeed}:mc:final`);
  const essayShuffled = seededShuffle(essaySelected, `${randomSeed}:essay:final`);

  return [...mcShuffled, ...essayShuffled];
};

export const createExamDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectId, title, examType, durationMinutes, requirements } = req.body as {
      subjectId: number;
      title: string;
      examType?: string;
      durationMinutes?: number;
      requirements: ExamRequirements;
    };

    if (!subjectId || !title || !requirements) {
      res.status(400).json({ error: 'subjectId, title, and requirements are required' });
      return;
    }

    const requirementsError = validateRequirements(requirements);
    if (requirementsError) {
      res.status(400).json({ error: requirementsError });
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: Number(subjectId) } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const rawQuestions = await prisma.question.findMany({
      where: { subjectId: Number(subjectId), status: 'ACTIVE' },
      select: {
        id: true,
        type: true,
        difficulty: true,
        learningOutcomeId: true,
        content: true,
        answer: true,
        options: true,
      },
    });

    const allQuestions: QuestionPoolItem[] = rawQuestions
      .filter((q) => q.type === 'MULTIPLE_CHOICE' || q.type === 'ESSAY')
      .map((q) => ({
        ...q,
        difficulty: normalizeDifficultyLabel(q.difficulty),
      }));

    const randomSeed = `${Date.now()}-${subjectId}-${req.user!.id}`;
    let selectedQuestions: QuestionPoolItem[];
    try {
      selectedQuestions = pickQuestionsByRequirements(allQuestions, requirements, randomSeed);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }

    const scanBlueprint = buildExamScanBlueprint(
      selectedQuestions
        .filter((item) => item.type === 'MULTIPLE_CHOICE')
        .map((item) => ({
          id: item.id,
          type: item.type,
          content: item.content || '',
          answer: item.answer || '',
          options: item.options || null,
        })),
      selectedQuestions
        .filter((item) => item.type === 'ESSAY')
        .map((item) => ({
          id: item.id,
          type: item.type,
          content: item.content || '',
          answer: item.answer || '',
          options: item.options || null,
        }))
    );

    const normalizedScannablePages = normalizePositiveInt(scanBlueprint.scannablePages, 1);
    const requirementsWithScanBlueprint: ExamRequirements = {
      ...requirements,
      scannablePages: normalizedScannablePages,
      scanBlueprint: {
        ...scanBlueprint,
        scannablePages: normalizedScannablePages,
      },
    };

    const created = await prisma.$transaction(async (tx) => {
      await deleteEmptyDraftExams(tx as unknown as PrismaClient, req.user!.id);

      const exam = await tx.exam.create({
        data: {
          subjectId: Number(subjectId),
          teacherId: req.user!.id,
          title,
          examType: examType || 'MIDTERM',
          durationMinutes: durationMinutes || 60,
          status: 'DRAFT',
          scannablePages: normalizedScannablePages,
          requirements: JSON.stringify(requirementsWithScanBlueprint),
          randomSeed,
        },
      });

      // Determine sectionPoints: defaults to 7 for MCQ and 3 for Essay
      const sectionPoints = (requirements && (requirements as any).sectionPoints)
        ? (requirements as any).sectionPoints
        : { multipleChoice: 7, essay: 3 };

      const mcqCount = selectedQuestions.filter((sq) => sq.type === 'MULTIPLE_CHOICE').length;
      const essayCount = selectedQuestions.filter((sq) => sq.type === 'ESSAY').length;

      await tx.examQuestion.createMany({
        data: selectedQuestions.map((q, idx) => {
          const isMcq = q.type === 'MULTIPLE_CHOICE';
          const totalObjective = mcqCount > 0 ? Number(sectionPoints.multipleChoice ?? 7) : 0;
          const totalEssay = mcqCount > 0 ? Number(sectionPoints.essay ?? 3) : Number(sectionPoints.essay ?? 10);
          const pts = isMcq
            ? mcqCount > 0 ? Number((totalObjective / mcqCount).toFixed(4)) : 0
            : essayCount > 0 ? Number((totalEssay / essayCount).toFixed(4)) : 0;
          return {
            examId: exam.id,
            questionId: q.id,
            position: idx + 1,
            points: pts,
          };
        }),
      });

      return tx.exam.findUnique({
        where: { id: exam.id },
        include: {
          subject: { select: { id: true, name: true } },
          questions: {
            include: { question: true },
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create exam draft error:', error);
    res.status(500).json({ error: 'Failed to create exam draft' });
  }
};

export const listExams = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const exams = await prisma.exam.findMany({
      where: { teacherId: req.user!.id },
      select: {
        id: true,
        subjectId: true,
        teacherId: true,
        title: true,
        examType: true,
        examDate: true,
        durationMinutes: true,
        status: true,
        requirements: true,
        scannablePages: true,
        randomSeed: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { questions: true, sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const subjectIds = Array.from(new Set(exams.map((exam) => exam.subjectId)));
    const subjects = subjectIds.length > 0
      ? await prisma.subject.findMany({
        where: { id: { in: subjectIds } },
        select: { id: true, name: true },
      })
      : [];

    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const serialized = exams.map((exam) => ({
      ...exam,
      subject: subjectById.get(exam.subjectId) || {
        id: exam.subjectId,
        name: '[Deleted Subject]',
      },
    }));

    res.json(serialized);
  } catch (error) {
    console.error('List exams error:', error);
    res.status(500).json({ error: 'Failed to list exams' });
  }
};

export const getExamById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        subject: { select: { id: true, name: true } },
        questions: {
          include: { question: { include: { learningOutcome: true } } },
          orderBy: { position: 'asc' },
        },
        sessions: {
          include: {
            class: { select: { id: true, name: true } },
            _count: { select: { submissions: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    res.json(exam);
  } catch (error) {
    console.error('Get exam by id error:', error);
    res.status(500).json({ error: 'Failed to get exam' });
  }
};

export const getExamPreview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        subject: { select: { id: true, name: true } },
        questions: {
          include: {
            question: {
              include: { learningOutcome: { select: { code: true, description: true } } },
            },
          },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    const sections = {
      multipleChoice: exam.questions.filter((item) => item.question.type === 'MULTIPLE_CHOICE'),
      essay: exam.questions.filter((item) => item.question.type === 'ESSAY'),
    };

    res.json({ exam, sections });
  } catch (error) {
    console.error('Get exam preview error:', error);
    res.status(500).json({ error: 'Failed to get exam preview' });
  }
};

export const updateExamConfiguration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const { title, examType, examDate, durationMinutes, requirements } = req.body as {
      title?: string;
      examType?: string;
      examDate?: string;
      durationMinutes?: number;
      requirements?: ExamRequirements;
    };

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: {
          include: { question: { select: { id: true, type: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    if (await hasActiveSessionsForExam(examId)) {
      res.status(409).json({ error: 'Cannot modify exam while sessions are ONGOING or GRADING.' });
      return;
    }

    const existingRequirements = parseExamRequirements(exam.requirements);
    const fallbackBlueprint = buildFallbackScanBlueprintFromQuestions(exam.questions);
    const resolvedScanBlueprint = normalizeStoredScanBlueprint(
      requirements?.scanBlueprint || existingRequirements.scanBlueprint,
      fallbackBlueprint
    );
    const resolvedScannablePages = normalizePositiveInt(
      requirements?.scannablePages ?? existingRequirements.scannablePages,
      normalizePositiveInt(resolvedScanBlueprint.scannablePages, exam.scannablePages || 1)
    );
    resolvedScanBlueprint.scannablePages = resolvedScannablePages;

    const nextRequirements = requirements
      ? {
        ...existingRequirements,
        ...requirements,
        scannablePages: resolvedScannablePages,
        scanBlueprint: resolvedScanBlueprint,
      }
      : exam.requirements;

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: {
        title: title?.trim() || exam.title,
        examType: examType || exam.examType,
        examDate: examDate ? new Date(examDate) : exam.examDate,
        durationMinutes: Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : exam.durationMinutes,
        scannablePages: typeof nextRequirements === 'string'
          ? exam.scannablePages
          : normalizePositiveInt(nextRequirements.scannablePages, normalizePositiveInt(resolvedScanBlueprint.scannablePages, exam.scannablePages || 1)),
        requirements: typeof nextRequirements === 'string' ? nextRequirements : JSON.stringify(nextRequirements),
        version: exam.version + 1,
      },
      include: {
        subject: { select: { id: true, name: true } },
        questions: {
          include: { question: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    // If sectionPoints changed in provided requirements, redistribute points evenly across questions
    try {
      const incomingReq = requirements as ExamRequirements | undefined;
      if (incomingReq && (incomingReq as any).sectionPoints) {
        const sectionPoints = (incomingReq as any).sectionPoints as { multipleChoice?: number; essay?: number };

        const questions = updated.questions || [];
        const mcq = questions.filter((q) => q.question.type === 'MULTIPLE_CHOICE');
        const essayQ = questions.filter((q) => q.question.type === 'ESSAY');

        const mcqCount = mcq.length;
        const essayCount = essayQ.length;

        const totalObjective = mcqCount > 0 ? Number(sectionPoints.multipleChoice ?? 7) : 0;
        const totalEssay = mcqCount > 0 ? Number(sectionPoints.essay ?? 3) : Number(sectionPoints.essay ?? 10);

        await prisma.$transaction(async (tx) => {
          if (mcqCount > 0) {
            const per = Number((totalObjective / mcqCount).toFixed(4));
            await Promise.all(
              mcq.map((item) =>
                tx.examQuestion.update({ where: { examId_questionId: { examId: updated.id, questionId: item.questionId } }, data: { points: per } })
              )
            );
          }
          if (essayCount > 0) {
            const per = Number((totalEssay / essayCount).toFixed(4));
            await Promise.all(
              essayQ.map((item) =>
                tx.examQuestion.update({ where: { examId_questionId: { examId: updated.id, questionId: item.questionId } }, data: { points: per } })
              )
            );
          }
          await tx.exam.update({ where: { id: updated.id }, data: { version: { increment: 1 } } });
        });

        // reload updated exam
        const reloaded = await prisma.exam.findUnique({
          where: { id: updated.id },
          include: {
            subject: { select: { id: true, name: true } },
            questions: { include: { question: true }, orderBy: { position: 'asc' } },
          },
        });
        res.json(reloaded);
        return;
      }
    } catch (e) {
      console.error('Failed to redistribute points after configuration update', e);
    }

    res.json(updated);
  } catch (error) {
    console.error('Update exam configuration error:', error);
    res.status(500).json({ error: 'Failed to update exam configuration' });
  }
};

export const reorderExamQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const { orderedQuestionIds } = req.body as { orderedQuestionIds: number[] };

    if (!Array.isArray(orderedQuestionIds) || orderedQuestionIds.length === 0) {
      res.status(400).json({ error: 'orderedQuestionIds is required' });
      return;
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { questions: true },
    });

    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    if (await hasActiveSessionsForExam(examId)) {
      res.status(409).json({ error: 'Cannot reorder questions while sessions are ONGOING or GRADING.' });
      return;
    }

    const existingIds = exam.questions.map((item) => item.questionId).sort((a, b) => a - b);
    const incomingIds = [...orderedQuestionIds].sort((a, b) => a - b);
    if (JSON.stringify(existingIds) !== JSON.stringify(incomingIds)) {
      res.status(400).json({ error: 'orderedQuestionIds must match current exam questions' });
      return;
    }

    const offset = exam.questions.length;

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        exam.questions.map((item) =>
          tx.examQuestion.update({
            where: { examId_questionId: { examId, questionId: item.questionId } },
            data: { position: item.position + offset },
          })
        )
      );

      await Promise.all(
        orderedQuestionIds.map((questionId, index) =>
          tx.examQuestion.update({
            where: { examId_questionId: { examId, questionId } },
            data: { position: index + 1 },
          })
        )
      );
    });

    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: {
          include: { question: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Reorder exam questions error:', error);
    res.status(500).json({ error: 'Failed to reorder exam questions' });
  }
};

export const replaceExamQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const questionId = toInt(req.params.questionId);
    const { replacementQuestionId, autoReplace } = req.body as {
      replacementQuestionId?: number;
      autoReplace?: boolean;
    };

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { questions: true },
    });
    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    if (await hasActiveSessionsForExam(examId)) {
      res.status(409).json({ error: 'Cannot replace questions while sessions are ONGOING or GRADING.' });
      return;
    }

    const existingQuestion = exam.questions.find((item) => item.questionId === questionId);
    if (!existingQuestion) {
      res.status(404).json({ error: 'Question not found in exam' });
      return;
    }

    const currentQuestion = await prisma.question.findUnique({ where: { id: questionId } });
    if (!currentQuestion) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    let replacement = replacementQuestionId
      ? await prisma.question.findUnique({ where: { id: Number(replacementQuestionId) } })
      : null;

    if (!replacement && autoReplace) {
      const usedQuestionIds = exam.questions.map((item) => item.questionId);
      const candidates = await prisma.question.findMany({
        where: {
          subjectId: exam.subjectId,
          type: currentQuestion.type,
          difficulty: currentQuestion.difficulty,
          learningOutcomeId: currentQuestion.learningOutcomeId,
          status: 'ACTIVE',
          id: { notIn: usedQuestionIds },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (candidates.length === 0) {
        res.status(404).json({ error: 'No replacement question matches the current question type, difficulty, and learning outcome.' });
        return;
      }

      replacement = candidates[Math.floor(Math.random() * candidates.length)] || null;
    }

    if (!replacement) {
      res.status(400).json({ error: 'replacementQuestionId or autoReplace is required' });
      return;
    }

    if (replacement.subjectId !== exam.subjectId || currentQuestion.type !== replacement.type) {
      res.status(400).json({ error: 'Replacement question must have the same question type' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.examQuestion.delete({ where: { examId_questionId: { examId, questionId } } });
      await tx.examQuestion.create({
        data: {
          examId,
          questionId: replacement.id,
          position: existingQuestion.position,
          points: existingQuestion.points,
        },
      });
      await tx.exam.update({ where: { id: examId }, data: { version: { increment: 1 } } });
    });

    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: {
          include: { question: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Replace exam question error:', error);
    res.status(500).json({ error: 'Failed to replace question' });
  }
};

export const updateExamQuestionPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const questionId = toInt(req.params.questionId);
    const { points } = req.body as { points?: number };

    if (points === undefined || Number.isNaN(Number(points))) {
      res.status(400).json({ error: 'points is required' });
      return;
    }

    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { questions: true } });
    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    if (await hasActiveSessionsForExam(examId)) {
      res.status(409).json({ error: 'Cannot modify points while sessions are ONGOING or GRADING.' });
      return;
    }

    const existing = exam.questions.find((q) => q.questionId === questionId);
    if (!existing) {
      res.status(404).json({ error: 'Question not found in exam' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.examQuestion.update({
        where: { examId_questionId: { examId, questionId } },
        data: { points: Number(points) },
      });
      await tx.exam.update({ where: { id: examId }, data: { version: { increment: 1 } } });
    });

    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: { questions: { include: { question: true }, orderBy: { position: 'asc' } }, subject: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update question points error:', error);
    res.status(500).json({ error: 'Failed to update question points' });
  }
};

export const exportExamDocx = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        subject: true,
        questions: {
          include: { question: { include: { learningOutcome: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    const questionList = exam.questions.map((item) => item.question);
    const essayQuestions = questionList.filter((item) => item.type === 'ESSAY');
    const mcqQuestions = questionList.filter((item) => item.type === 'MULTIPLE_CHOICE');

    // Build points map from ExamQuestion rows for accurate docx rendering
    const pointsMap = new Map<number, number>();
    for (const eq of exam.questions) {
      pointsMap.set(eq.questionId, eq.points);
    }

    const parsedRequirements = parseExamRequirements(exam.requirements);
    const regeneratedBlueprint = buildExamScanBlueprint(mcqQuestions, essayQuestions, {
      scannablePages: normalizePositiveInt(
        parsedRequirements.scanBlueprint?.scannablePages
          ?? parsedRequirements.scannablePages,
        0
      ),
      passPurposeByIndex: parsedRequirements.scanBlueprint?.passPurposeByIndex || {},
      identityPlaceholders: parsedRequirements.scanBlueprint?.identityPlaceholders,
      markerAnchors: parsedRequirements.scanBlueprint?.markerAnchors,
      omrTemplate: parsedRequirements.scanBlueprint?.omrTemplate,
    });
    const exportedScannablePages = normalizePositiveInt(regeneratedBlueprint.scannablePages, 1);

    await prisma.exam.update({
      where: { id: exam.id },
      data: {
        scannablePages: exportedScannablePages,
        requirements: JSON.stringify({
          ...parsedRequirements,
          scannablePages: exportedScannablePages,
          scanBlueprint: {
            ...regeneratedBlueprint,
            scannablePages: exportedScannablePages,
          },
        }),
      },
    });

    const docBuffer = mcqQuestions.length === 0
      ? await generateEssayExamDocx(exam.subject.name, exam.durationMinutes, essayQuestions, pointsMap)
      : await generateMcqEssayExamDocx(exam.subject.name, exam.durationMinutes, mcqQuestions, essayQuestions, pointsMap);

    const filename = `exam_${exam.subject.name.replace(/\s+/g, '_')}_${exam.id}_v${exam.version}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(docBuffer);
  } catch (error) {
    console.error('Export exam docx error:', error);
    res.status(500).json({ error: 'Failed to export exam' });
  }
};

export const createExamSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const { classId } = req.body as { classId: number };

    if (!classId) {
      res.status(400).json({ error: 'classId is required' });
      return;
    }

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    const cls = await prisma.class.findUnique({ where: { id: Number(classId) } });
    if (!cls || cls.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const session = await prisma.examSession.create({
      data: {
        examId,
        classId: Number(classId),
        status: 'DRAFT',
      },
      include: {
        class: { select: { id: true, name: true } },
        exam: { select: { id: true, title: true } },
      },
    });

    res.status(201).json(session);
  } catch (error) {
    console.error('Create exam session error:', error);
    res.status(500).json({ error: 'Failed to create exam session' });
  }
};

export const createSessionMobileScanLink = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: { select: { teacherId: true, title: true } },
        class: { select: { name: true } },
      },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const token = signMobileScanToken(req.user!.id, sessionId);
    const encodedToken = encodeURIComponent(token);
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const frontendBaseUrl = origin && /^https?:\/\//i.test(origin) ? origin.replace(/\/+$/, '') : config.frontendUrl;
    const scanUrl = `${frontendBaseUrl}/mobile-scan?token=${encodedToken}`;

    res.json({
      token,
      scanUrl,
      session: {
        id: session.id,
        examTitle: session.exam.title,
        className: session.class.name,
      },
      expiresIn: '8h',
    });
  } catch (error) {
    console.error('Create mobile scan link error:', error);
    res.status(500).json({ error: 'Failed to create mobile scan link' });
  }
};

export const getMobileScanContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = String(req.query.token || '');
    if (!token) {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    const payload = verifyMobileScanToken(token);

    const session = await prisma.examSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            teacherId: true,
            requirements: true,
            scannablePages: true,
            questions: {
              include: { question: true },
              orderBy: { position: 'asc' },
            },
          },
        },
        class: { select: { id: true, name: true } },
      },
    });

    if (!session || session.exam.teacherId !== payload.teacherId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    if (!Number.isFinite(expectedPages) || expectedPages <= 0) {
      res.status(400).json({ error: 'Exam scannable page count is invalid. Please export exam again before scanning.' });
      return;
    }

    await ensureSessionSubmissionRows(session.id, session.classId);

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId: session.id },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { student: { fullName: 'asc' } },
    });

    res.json({
      session: {
        id: session.id,
        status: session.status,
        class: session.class,
        exam: {
          id: session.exam.id,
          title: session.exam.title,
          hasMcq: session.exam.questions.some((item) => item.question.type === 'MULTIPLE_CHOICE'),
          essayQuestionIds: session.exam.questions
            .filter((item) => item.question.type === 'ESSAY')
            .map((item) => item.question.id),
          expectedPages,
          passPurposeByIndex: passPlan.passPurposeByIndex,
        },
      },
      students: submissions.map((submission) => ({
        submissionId: submission.id,
        studentId: submission.studentId,
        student: submission.student,
        status: submission.status,
        finalScore: submission.finalScore,
        scanEntries: parseAccessibleScanEntries(submission.scanFiles || '[]'),
        scanCount: parseScanEntries(submission.scanFiles || '[]').length,
        mergedPdfUrl: getMergedPdfUrlFromEntries(parseScanEntries(submission.scanFiles || '[]')),
      })),
    });
  } catch (error) {
    const httpError = error as HttpError;
    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: httpError.message });
      return;
    }
    console.error('Get mobile scan context error:', error);
    res.status(500).json({ error: 'Failed to load mobile scan context' });
  }
};

export const uploadMobileSubmissionScans = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = String(req.body.token || '');
    const rawStudentId = toInt(req.body.studentId);
    const passIndex = Number.isFinite(Number(req.body.passIndex)) ? Number(req.body.passIndex) : undefined;
    const purpose = req.body.purpose ? String(req.body.purpose) : undefined;
    const files = ((req as Request & { files?: Express.Multer.File[] }).files || []) as Express.Multer.File[];

    if (!token || files.length === 0) {
      res.status(400).json({ error: 'token and at least one scan file are required' });
      return;
    }

    const payload = verifyMobileScanToken(token);

    const session = await prisma.examSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        exam: {
          include: {
            questions: {
              include: { question: { select: { id: true, type: true } } },
              orderBy: { position: 'asc' },
            },
          },
        },
        class: true,
      },
    });

    if (!session || session.exam.teacherId !== payload.teacherId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const enrolledStudents = await prisma.classStudent.findMany({
      where: { classId: session.classId },
      select: {
        student: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    if (enrolledStudents.length === 0) {
      res.status(400).json({ error: 'No enrolled students found in this class' });
      return;
    }

    let studentId: number | null = Number.isFinite(Number(rawStudentId)) && rawStudentId > 0 ? rawStudentId : null;
    let extractedIdentity: { fullName: string | null; studentCode: string | null } | null = null;
    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    if (!Number.isFinite(expectedPages) || expectedPages <= 0) {
      res.status(400).json({ error: 'Exam scannable page count is invalid. Please export exam again before scanning.' });
      return;
    }

    if (studentId) {
      const enrolled = enrolledStudents.some((item) => item.student.id === studentId);
      if (!enrolled) {
        res.status(400).json({ error: 'Student is not enrolled in this class' });
        return;
      }
    } else {
      try {
        extractedIdentity = await extractStudentIdentityFromOmr(files[0].path);
      } catch (error) {
        res.status(422).json({
          error: TEACHER_IDENTITY_MESSAGE,
          errorCode: 'IDENTITY_FAIL',
          technicalMessage: (error as Error).message,
          requiresManualSelection: true,
        });
        return;
      }

      const resolved = resolveStudentFromIdentity(
        enrolledStudents.map((item) => item.student),
        extractedIdentity
      );

      if (!resolved.matched) {
        res.status(422).json({
          error: TEACHER_IDENTITY_MESSAGE,
          errorCode: 'IDENTITY_FAIL',
          requiresManualSelection: true,
          extractedIdentity,
          candidates: resolved.ambiguous.map((student) => ({
            id: student.id,
            username: student.username,
            fullName: student.fullName,
          })),
        });
        return;
      }

      studentId = resolved.matched.id;
    }

    if (!studentId) {
      res.status(422).json({
        error: TEACHER_IDENTITY_MESSAGE,
        errorCode: 'IDENTITY_FAIL',
        requiresManualSelection: true,
      });
      return;
    }

    const resolvedStudentId = studentId;
    const resolvedStudent = enrolledStudents.find((item) => item.student.id === resolvedStudentId)?.student || null;

    if (!Number.isFinite(Number(passIndex))) {
      res.status(400).json({ error: 'passIndex is required for mobile capture upload' });
      return;
    }
    const normalizedPassIndex = Number(passIndex);

    if (normalizedPassIndex < 1 || normalizedPassIndex > expectedPages) {
      res.status(400).json({ error: `passIndex must be within 1..${expectedPages}` });
      return;
    }

    if (files.length !== 1) {
      res.status(400).json({ error: 'Mobile capture upload accepts exactly one image per pass' });
      return;
    }

    const invalidScans = await collectInvalidScans(files, normalizedPassIndex);
    if (invalidScans.length > 0) {
      throw createHttpError(
        422,
        TEACHER_QUALITY_MESSAGE,
        {
          errorCode: 'QUALITY_FAIL',
          invalidScans,
          requiresRetake: true,
        }
      );
    }

    const { submission, mergedScans, mergedPdfUrl } = await persistSubmissionScans({
      sessionId: session.id,
      studentId: resolvedStudentId,
      files,
      passIndex: normalizedPassIndex,
      totalPasses: expectedPages,
      purpose: purpose || getScanPassPurpose(normalizedPassIndex, passPlan),
    });

    res.status(201).json({
      ...submission,
      resolvedStudent,
      resolvedStudentId,
      extractedIdentity,
      scanCount: mergedScans.length,
      scanEntries: mergedScans.map(toAccessibleScanEntry),
      mergedPdfUrl,
    });
  } catch (error) {
    const httpError = error as HttpError;
    const message = mapTeacherFacingErrorMessage(error, 'Failed to upload scanned submission from mobile');

    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: message, ...(httpError.payload as Record<string, unknown> || {}) });
      return;
    }

    const geminiStatus = getGeminiErrorStatusCode(error);
    if (geminiStatus === 429 || geminiStatus === 503) {
      res.status(geminiStatus).json({ error: message });
      return;
    }

    console.error('Upload mobile submission scans error:', error);
    res.status(500).json({ error: message });
  }
};

export const cloneExamToDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const { title, durationMinutes } = req.body as { title?: string; durationMinutes?: number };
    const source = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: {
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!source || source.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      await deleteEmptyDraftExams(tx as unknown as PrismaClient, req.user!.id);

      const exam = await tx.exam.create({
        data: {
          subjectId: source.subjectId,
          teacherId: source.teacherId,
          title: String(title || `${source.title} (Copy)`),
          examType: source.examType,
          examDate: source.examDate,
          durationMinutes: Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : source.durationMinutes,
          status: 'DRAFT',
          scannablePages: source.scannablePages,
          requirements: source.requirements,
          randomSeed: `${Date.now()}-clone-${source.id}`,
        },
      });

      await tx.examQuestion.createMany({
        data: source.questions.map((item) => ({
          examId: exam.id,
          questionId: item.questionId,
          position: item.position,
          points: item.points,
        })),
      });

      return tx.exam.findUnique({
        where: { id: exam.id },
        include: {
          subject: { select: { id: true, name: true } },
          questions: {
            include: { question: { include: { learningOutcome: true } } },
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Clone exam to draft error:', error);
    res.status(500).json({ error: 'Failed to clone exam to draft' });
  }
};

export const cloneExamConfigToDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const { title, durationMinutes } = req.body as { title?: string; durationMinutes?: number };
    const source = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: {
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!source || source.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    // Validate requirements exist on source
    const parsedReq = parseExamRequirements(source.requirements || '{}') as ExamRequirements;
    const requirementsError = validateRequirements(parsedReq as ExamRequirements);
    if (requirementsError) {
      res.status(400).json({ error: `Invalid requirements on source exam: ${requirementsError}` });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      await deleteEmptyDraftExams(tx as unknown as PrismaClient, req.user!.id);

      const randomSeed = `${Date.now()}-clone-config-${source.id}`;

      // Fetch all candidate questions for the subject
      const rawQuestions = await tx.question.findMany({
        where: { subjectId: source.subjectId, status: 'ACTIVE' },
        select: {
          id: true,
          type: true,
          difficulty: true,
          learningOutcomeId: true,
          content: true,
          answer: true,
          options: true,
        },
      });

      const allQuestions: QuestionPoolItem[] = (rawQuestions || [])
        .filter((q) => q.type === 'MULTIPLE_CHOICE' || q.type === 'ESSAY')
        .map((q) => ({ ...q, difficulty: normalizeDifficultyLabel(q.difficulty) }));

      // Pick questions according to requirements (may throw if insufficient)
      let selectedQuestions: QuestionPoolItem[];
      try {
        selectedQuestions = pickQuestionsByRequirements(allQuestions, parsedReq as ExamRequirements, randomSeed);
      } catch (err) {
        throw createHttpError(400, (err as Error).message);
      }

      // Build scan blueprint from the selected questions and normalize scannable pages
      const scanBlueprint = buildExamScanBlueprint(
        selectedQuestions
          .filter((item) => item.type === 'MULTIPLE_CHOICE')
          .map((item) => ({
            id: item.id,
            type: item.type,
            content: item.content || '',
            answer: item.answer || '',
            options: item.options || null,
          })),
        selectedQuestions
          .filter((item) => item.type === 'ESSAY')
          .map((item) => ({
            id: item.id,
            type: item.type,
            content: item.content || '',
            answer: item.answer || '',
            options: item.options || null,
          }))
      );

      const normalizedScannablePages = normalizePositiveInt(scanBlueprint.scannablePages, 1);

      // Merge scanBlueprint into requirements to persist
      const requirementsWithScanBlueprint: ExamRequirements = {
        ...parsedReq,
        scannablePages: normalizedScannablePages,
        scanBlueprint: {
          ...scanBlueprint,
          scannablePages: normalizedScannablePages,
        },
      };

      // Create exam row with JSON-stringified requirements (same as createExamDraft)
      const exam = await tx.exam.create({
        data: {
          subjectId: source.subjectId,
          teacherId: source.teacherId,
          title: String(title || `${source.title} (Config Copy)`),
          examType: source.examType,
          examDate: source.examDate,
          durationMinutes: Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : source.durationMinutes,
          status: 'DRAFT',
          scannablePages: normalizedScannablePages,
          requirements: JSON.stringify(requirementsWithScanBlueprint),
          randomSeed,
        },
      });

      // Determine sectionPoints (reuse same logic as createExamDraft)
      const sectionPoints = (parsedReq && (parsedReq as any).sectionPoints)
        ? (parsedReq as any).sectionPoints
        : { multipleChoice: 7, essay: 3 };

      const mcqCount = selectedQuestions.filter((sq) => sq.type === 'MULTIPLE_CHOICE').length;
      const essayCount = selectedQuestions.filter((sq) => sq.type === 'ESSAY').length;

      await tx.examQuestion.createMany({
        data: selectedQuestions.map((q, idx) => {
          const isMcq = q.type === 'MULTIPLE_CHOICE';
          const totalObjective = mcqCount > 0 ? Number(sectionPoints.multipleChoice ?? 7) : 0;
          const totalEssay = mcqCount > 0 ? Number(sectionPoints.essay ?? 3) : Number(sectionPoints.essay ?? 10);
          const pts = isMcq
            ? mcqCount > 0 ? Number((totalObjective / mcqCount).toFixed(4)) : 0
            : essayCount > 0 ? Number((totalEssay / essayCount).toFixed(4)) : 0;
          return {
            examId: exam.id,
            questionId: q.id,
            position: idx + 1,
            points: pts,
          };
        }),
      });

      return tx.exam.findUnique({
        where: { id: exam.id },
        include: {
          subject: { select: { id: true, name: true } },
          questions: {
            include: { question: { include: { learningOutcome: true } } },
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    res.status(201).json(created);
  } catch (error) {
    if ((error as any).statusCode === 400 || (error as any).message) {
      console.error('Clone exam config to draft error:', error);
      res.status((error as any).statusCode || 400).json({ error: (error as any).message || 'Failed to clone exam config to draft' });
      return;
    }
    console.error('Clone exam config to draft error:', error);
    res.status(500).json({ error: 'Failed to clone exam config to draft' });
  }
};

export const updateExamSessionStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);
    const { status } = req.body as { status: 'DRAFT' | 'ONGOING' | 'GRADING' | 'COMPLETED' };

    if (!['DRAFT', 'ONGOING', 'GRADING', 'COMPLETED'].includes(status)) {
      res.status(400).json({ error: 'Invalid session status' });
      return;
    }

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: true },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (status === 'COMPLETED') {
      const pendingForPublish = await prisma.examSubmission.count({
        where: {
          sessionId,
          OR: [
            { status: { not: 'FINALIZED' } },
            { finalScore: null },
          ],
        },
      });

      if (pendingForPublish > 0) {
        res.status(409).json({
          error: 'Cannot complete session before report confirmation and score finalization',
          pendingForPublish,
        });
        return;
      }
    }

    const updated = await prisma.examSession.update({
      where: { id: sessionId },
      data: {
        status,
        startedAt: status === 'ONGOING' && !session.startedAt ? new Date() : session.startedAt,
        endedAt: status === 'COMPLETED' ? new Date() : null,
      },
      include: {
        class: { select: { id: true, name: true } },
        exam: { select: { id: true, title: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update exam session status error:', error);
    res.status(500).json({ error: 'Failed to update exam session status' });
  }
};

export const deleteExamSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: true },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await prisma.examSession.delete({ where: { id: sessionId } });
    res.json({ message: 'Session deleted successfully', sessionId });
  } catch (error) {
    console.error('Delete exam session error:', error);
    res.status(500).json({ error: 'Failed to delete exam session' });
  }
};

export const uploadSubmissionScans = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);
    const rawStudentId = toInt(req.body.studentId);
    const passIndex = Number.isFinite(Number(req.body.passIndex)) ? Number(req.body.passIndex) : undefined;
    const purpose = req.body.purpose ? String(req.body.purpose) : undefined;
    const files = sortUploadedScanFiles(((req as AuthRequest & { files?: Express.Multer.File[] }).files || []) as Express.Multer.File[]);

    if (files.length === 0) {
      res.status(400).json({ error: 'at least one scan file is required' });
      return;
    }

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: {
          include: {
            questions: {
              include: { question: { select: { id: true, type: true } } },
              orderBy: { position: 'asc' },
            },
          },
        },
        class: true,
      },
    });
    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    if (!Number.isFinite(expectedPages) || expectedPages <= 0) {
      res.status(400).json({ error: 'Exam scannable page count is invalid. Please export exam again before scanning.' });
      return;
    }
    const isCaptureMode = Number.isFinite(Number(passIndex));

    let resolvedStudentId: number | null = Number.isFinite(Number(rawStudentId)) && rawStudentId > 0 ? rawStudentId : null;
    let extractedIdentity: { fullName: string | null; studentCode: string | null } | null = null;

    if (resolvedStudentId) {
      const enrolled = await prisma.classStudent.findUnique({
        where: { classId_studentId: { classId: session.classId, studentId: resolvedStudentId } },
      });
      if (!enrolled) {
        res.status(400).json({ error: 'Student is not enrolled in this class' });
        return;
      }
    } else {
      const enrolledStudents = await prisma.classStudent.findMany({
        where: { classId: session.classId },
        select: {
          student: {
            select: { id: true, username: true, fullName: true },
          },
        },
      });

      if (enrolledStudents.length === 0) {
        res.status(400).json({ error: 'No enrolled students found in this class' });
        return;
      }

      try {
        extractedIdentity = await extractStudentIdentityFromOmr(files[0].path);
      } catch (error) {
        res.status(422).json({
          error: TEACHER_IDENTITY_MESSAGE,
          errorCode: 'IDENTITY_FAIL',
          technicalMessage: (error as Error).message,
          requiresManualSelection: true,
        });
        return;
      }

      const resolved = resolveStudentFromIdentity(
        enrolledStudents.map((item) => item.student),
        extractedIdentity
      );

      if (!resolved.matched) {
        res.status(422).json({
          error: TEACHER_IDENTITY_MESSAGE,
          errorCode: 'IDENTITY_FAIL',
          requiresManualSelection: true,
          extractedIdentity,
          candidates: resolved.ambiguous.map((student) => ({
            id: student.id,
            username: student.username,
            fullName: student.fullName,
          })),
        });
        return;
      }

      resolvedStudentId = resolved.matched.id;
    }

    if (!resolvedStudentId) {
      res.status(422).json({
        error: TEACHER_IDENTITY_MESSAGE,
        errorCode: 'IDENTITY_FAIL',
        requiresManualSelection: true,
      });
      return;
    }

    if (!isCaptureMode && files.length !== expectedPages) {
      res.status(400).json({
        error: `Upload Full Set requires exactly ${expectedPages} image(s). Received ${files.length}.`,
      });
      return;
    }

    if (isCaptureMode && (Number(passIndex) < 1 || Number(passIndex) > expectedPages)) {
      res.status(400).json({ error: `passIndex must be within 1..${expectedPages}` });
      return;
    }

    if (isCaptureMode && files.length !== 1) {
      res.status(400).json({ error: 'Capture upload accepts exactly one image for each pass' });
      return;
    }

    const invalidScans = await collectInvalidScans(files, isCaptureMode ? Number(passIndex) : 1);
    if (invalidScans.length > 0) {
      throw createHttpError(
        422,
        TEACHER_QUALITY_MESSAGE,
        {
          errorCode: 'QUALITY_FAIL',
          invalidScans,
          requiresRetake: true,
        }
      );
    }

    const { submission, mergedScans, mergedPdfUrl } = await persistSubmissionScans({
      sessionId,
      studentId: resolvedStudentId,
      files,
      passIndex: isCaptureMode ? Number(passIndex) : undefined,
      totalPasses: expectedPages,
      purpose: isCaptureMode
        ? (purpose || getScanPassPurpose(Number(passIndex), passPlan))
        : undefined,
      replaceExisting: !isCaptureMode,
      sequentialPasses: !isCaptureMode,
      passPurposeResolver: !isCaptureMode ? (passIdx: number) => getScanPassPurpose(passIdx, passPlan) : undefined,
    });

    const resolvedStudent = await prisma.user.findUnique({
      where: { id: resolvedStudentId },
      select: { id: true, username: true, fullName: true },
    });

    res.status(201).json({
      ...submission,
      resolvedStudent,
      resolvedStudentId,
      extractedIdentity,
      scanCount: mergedScans.length,
      scanEntries: mergedScans.map(toAccessibleScanEntry),
      mergedPdfUrl,
    });
  } catch (error) {
    const httpError = error as HttpError;
    const message = mapTeacherFacingErrorMessage(error, 'Failed to upload scanned submission');

    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: message, ...(httpError.payload as Record<string, unknown> || {}) });
      return;
    }

    const geminiStatus = getGeminiErrorStatusCode(error);
    if (geminiStatus === 429 || geminiStatus === 503) {
      res.status(geminiStatus).json({ error: message });
      return;
    }

    console.error('Upload submission scans error:', error);
    res.status(500).json({ error: message });
  }
};

export const getSessionSubmissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: true },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await ensureSessionSubmissionRows(sessionId, session.classId);

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
        grades: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { student: { fullName: 'asc' } },
    });

    res.json(
      submissions.map((submission) => {
        const details = extractSubmissionReportDetails({
          feedback: submission.feedback,
          scanFiles: submission.scanFiles,
        });

        return {
          ...submission,
          scanEntries: parseAccessibleScanEntries(submission.scanFiles || '[]'),
          scanCount: parseScanEntries(submission.scanFiles || '[]').length,
          mergedPdfUrl: details.mergedPdfUrl,
          objectiveScore: details.objectiveScore,
          essayScore: details.essayScore,
          totalScore: details.totalScore,
          aiComments: details.aiComments,
          warnings: details.warnings,
        };
      })
    );
  } catch (error) {
    console.error('Get session submissions error:', error);
    res.status(500).json({ error: 'Failed to get session submissions' });
  }
};

export const gradeSubmissionWithAI = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const submissionId = toInt(req.params.submissionId);
    const { useScanExtraction = true } = req.body as {
      useScanExtraction?: boolean;
    };

    if (!useScanExtraction) {
      res.status(400).json({ error: 'AI grading requires scan extraction mode.' });
      return;
    }

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        student: {
          select: { id: true, fullName: true, username: true },
        },
        session: {
          include: {
            exam: {
              include: {
                questions: {
                  include: { question: true },
                  orderBy: { position: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!submission || submission.session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(submission.session.exam.questions, submission.session.exam.requirements);

    const warnings: string[] = [];
    const objectiveAnswers: Record<string, string> = {};
    const essayAnswers: Record<string, string> = {};
    let essayResults: Array<{ questionId: number; score: number; maxScore: number; feedback: string }> = [];
    let extractedIdentity: { fullName: string | null; studentCode: string | null } | null = null;
    const submissionScanEntries = parseScanEntries(submission.scanFiles || '[]');
    const mergedPdfUrl = getMergedPdfUrlFromEntries(submissionScanEntries);

    if (submissionScanEntries.length === 0) {
      res.status(400).json({ error: 'No scan files found. Please upload scans before AI grading.' });
      return;
    }

    const batchExtraction = await extractBatchScanGradingData(
      submissionScanEntries,
      submission.session.exam.questions,
      scanBlueprint
    );

    Object.assign(objectiveAnswers, batchExtraction.objectiveAnswers);
    Object.assign(essayAnswers, batchExtraction.essayAnswers);
    essayResults = batchExtraction.essayResults;
    warnings.push(...batchExtraction.warnings);
    extractedIdentity = batchExtraction.extractedIdentity;

    if (!Object.keys(batchExtraction.objectiveAnswers).length) {
      warnings.push('No objective answers extracted from scan');
    }
    if (!Object.keys(batchExtraction.essayAnswers).length) {
      warnings.push('No essay answers extracted from scan');
    }

    let objectiveScore = 0;
    for (const examQuestion of submission.session.exam.questions) {
      const question = examQuestion.question;
      const key = String(question.id);

      if (question.type === 'ESSAY') {
        continue;
      }

      const submitted = (objectiveAnswers[key] || '').trim().toLowerCase();
      const expected = (question.answer || '').trim().toLowerCase();
      if (submitted && submitted === expected) {
        objectiveScore += examQuestion.points;
      }
    }

    const essayScore = essayResults.reduce((acc, item) => acc + item.score, 0);
    const totalScore = Number((objectiveScore + essayScore).toFixed(2));

    let identityCheck: { nameMatch: boolean; codeMatch: boolean } | null = null;
    if (extractedIdentity) {
      const expectedName = (submission.student?.fullName || '').trim().toLowerCase();
      const expectedCode = normalizeStudentCode(submission.student?.username);
      const foundName = (extractedIdentity.fullName || '').trim().toLowerCase();
      const foundCode = normalizeStudentCode(extractedIdentity.studentCode);

      identityCheck = {
        nameMatch: !!foundName && expectedName.includes(foundName),
        codeMatch: !!foundCode && expectedCode === foundCode,
      };

      if (!identityCheck.nameMatch || !identityCheck.codeMatch) {
        warnings.push('Student identity extracted from scan does not fully match enrollment data');
      }
    }

    const aiComments = essayResults.length > 0
      ? 'Đã chấm trắc nghiệm bằng OMR cục bộ và tự luận bằng AI trên bộ ảnh quét.'
      : null;
    const gradedScanCount = Math.min(
      submissionScanEntries.length,
      normalizePositiveInt(scanBlueprint.scannablePages, submissionScanEntries.length)
    );

    const feedbackPayload = {
      identity: extractedIdentity,
      identityCheck,
      objectiveScore,
      essayScore,
      totalScore,
      objectiveAnswers,
      essayAnswers,
      essayResults,
      aiComments,
      warnings: [...new Set(warnings)],
      mergedPdfUrl,
      scanBlueprint: {
        scannablePages: scanBlueprint.scannablePages,
        passPurposeByIndex: scanBlueprint.passPurposeByIndex,
      },
    };

    const updated = await prisma.$transaction(async (tx) => {
      await tx.submissionGrade.create({
        data: {
          submissionId: submission.id,
          graderId: req.user!.id,
          method: 'AI',
          objectiveScore,
          essayScore,
          totalScore,
          rubricVersion: `exam-v${submission.session.exam.version}`,
          promptLog: JSON.stringify({
            mode: 'multimodal_batch',
            imageCount: gradedScanCount,
            useScanExtraction: true,
          }),
          responseLog: JSON.stringify(feedbackPayload),
        },
      });

      await tx.gradingAuditLog.create({
        data: {
          submissionId: submission.id,
          actorId: req.user!.id,
          action: 'AI_GRADED',
          beforeScore: submission.finalScore ?? null,
          afterScore: totalScore,
          note: JSON.stringify({ useScanExtraction: !!useScanExtraction, warnings: feedbackPayload.warnings }),
        },
      });

      return tx.examSubmission.update({
        where: { id: submission.id },
        data: {
          objectiveAnswers: JSON.stringify(objectiveAnswers),
          essayAnswers: JSON.stringify(essayAnswers),
          aiScore: totalScore,
          finalScore: totalScore,
          status: 'GRADED',
          gradedAt: new Date(),
          feedback: JSON.stringify(feedbackPayload),
        },
        include: {
          student: { select: { id: true, fullName: true, username: true } },
          grades: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    res.json(updated);
  } catch (error) {
    const httpError = error as HttpError;
    const message = mapTeacherFacingErrorMessage(error, 'Failed to grade submission with AI');

    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: message, ...(httpError.payload as Record<string, unknown> || {}) });
      return;
    }

    const geminiStatus = getGeminiErrorStatusCode(error);
    if (geminiStatus === 429 || geminiStatus === 503) {
      res.status(geminiStatus).json({ error: message });
      return;
    }

    console.error('Grade submission with AI error:', error);
    res.status(500).json({ error: message });
  }
};

export const gradeSubmissionWithOmr = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const submissionId = toInt(req.params.submissionId);
    const { template } = req.body as { template: OmrTemplate };

    if (!template || !Array.isArray(template.questions) || template.questions.length === 0) {
      res.status(400).json({ error: 'OMR template is required' });
      return;
    }

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        session: {
          include: {
            exam: {
              include: {
                questions: {
                  include: { question: true },
                },
              },
            },
          },
        },
      },
    });

    if (!submission || submission.session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    const scanEntries = parseScanEntries(submission.scanFiles || '[]');
    if (scanEntries.length === 0) {
      res.status(400).json({ error: 'No scan file found for this submission' });
      return;
    }

    const firstScan = scanEntries[0];
    const scanPath = await resolveScanPath(firstScan);
    let detection: Awaited<ReturnType<typeof detectDocumentForOmr>> | null = null;
    let detectedAnswers: Record<string, string> = {};

    try {
      const preprocessed = await preprocessScanForAnalysis(scanPath);
      try {
        detection = await detectDocumentForOmr(preprocessed.processedPath);
        const calibratedTemplate = calibrateOmrTemplate(template, detection);
        detectedAnswers = await detectMarkedOptions(preprocessed.processedPath, calibratedTemplate);
        if (preprocessed.warnings.length > 0) {
          detection = {
            ...detection,
            warnings: [...new Set([...detection.warnings, ...preprocessed.warnings])],
          };
        }
      } finally {
        preprocessed.cleanup();
      }
    } finally {
      if (path.basename(scanPath).startsWith('scan_tmp_')) {
        fs.unlink(scanPath, () => undefined);
      }
    }

    if (!detection) {
      throw new Error('OMR preprocessing did not return detection results');
    }

    let objectiveScore = 0;
    for (const examQuestion of submission.session.exam.questions) {
      const question = examQuestion.question;
      if (question.type === 'ESSAY') continue;

      const detected = (detectedAnswers[String(question.id)] || '').trim().toLowerCase();
      const expected = (question.answer || '').trim().toLowerCase();
      if (detected && detected === expected) {
        objectiveScore += examQuestion.points;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.submissionGrade.create({
        data: {
          submissionId,
          graderId: req.user!.id,
          method: 'MANUAL',
          objectiveScore,
          essayScore: 0,
          totalScore: objectiveScore,
          responseLog: JSON.stringify({ detectedAnswers, detection }),
        },
      });

      await tx.gradingAuditLog.create({
        data: {
          submissionId,
          actorId: req.user!.id,
          action: 'OMR_GRADED',
          beforeScore: submission.finalScore ?? null,
          afterScore: objectiveScore,
          note: JSON.stringify({
            message: 'Objective questions graded via OMR pipeline',
            warnings: detection.warnings,
          }),
        },
      });

      return tx.examSubmission.update({
        where: { id: submissionId },
        data: {
          objectiveAnswers: JSON.stringify(detectedAnswers),
          finalScore: objectiveScore,
          aiScore: submission.aiScore,
          status: 'GRADED',
          gradedAt: new Date(),
        },
      });
    });

    res.json(updated);
  } catch (error) {
    console.error('Grade submission with OMR error:', error);
    res.status(500).json({ error: 'Failed to grade submission with OMR' });
  }
};

export const reviewSubmissionScore = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const submissionId = toInt(req.params.submissionId);
    const { finalScore, note } = req.body as { finalScore: number; note?: string };

    if (!Number.isFinite(finalScore)) {
      res.status(400).json({ error: 'finalScore must be a number' });
      return;
    }

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        session: { include: { exam: true } },
      },
    });

    if (!submission || submission.session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    const reviewed = await prisma.$transaction(async (tx) => {
      await tx.submissionGrade.create({
        data: {
          submissionId,
          graderId: req.user!.id,
          method: 'MANUAL',
          totalScore: finalScore,
          objectiveScore: 0,
          essayScore: 0,
          responseLog: JSON.stringify({ note: note || '' }),
        },
      });

      await tx.gradingAuditLog.create({
        data: {
          submissionId,
          actorId: req.user!.id,
          action: 'MANUAL_REVIEW',
          note: note || null,
          beforeScore: submission.finalScore ?? null,
          afterScore: finalScore,
        },
      });

      return tx.examSubmission.update({
        where: { id: submissionId },
        data: {
          finalScore,
          status: 'FINALIZED',
        },
        include: {
          student: { select: { id: true, username: true, fullName: true } },
          grades: { orderBy: { createdAt: 'desc' } },
          auditLogs: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    res.json(reviewed);
  } catch (error) {
    console.error('Review submission score error:', error);
    res.status(500).json({ error: 'Failed to review submission score' });
  }
};

export const getSessionReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        class: { select: { id: true, name: true } },
        exam: {
          include: {
            subject: { select: { id: true, name: true } },
            questions: {
              include: { question: true },
            },
          },
        },
      },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    if (!Number.isFinite(expectedPages) || expectedPages <= 0) {
      res.status(400).json({ error: 'Exam scannable page count is invalid. Please export exam again before scanning.' });
      return;
    }

    const sessionPayload = {
      ...session,
      exam: {
        ...session.exam,
        expectedPages,
        passPurposeByIndex: passPlan.passPurposeByIndex,
      },
    };

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
      },
    });

    const enrichedSubmissions = submissions.map((submission) => {
      const details = extractSubmissionReportDetails({
        feedback: submission.feedback,
        scanFiles: submission.scanFiles,
      });

      return {
        ...submission,
        scanEntries: parseAccessibleScanEntries(submission.scanFiles || '[]'),
        scanCount: parseScanEntries(submission.scanFiles || '[]').length,
        mergedPdfUrl: details.mergedPdfUrl,
        objectiveScore: details.objectiveScore,
        essayScore: details.essayScore,
        totalScore: details.totalScore,
        aiComments: details.aiComments,
        warnings: details.warnings,
      };
    });

    const scores = enrichedSubmissions.map((s) => s.finalScore || 0);
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const min = scores.length ? Math.min(...scores) : 0;

    res.json({
      session: sessionPayload,
      totals: {
        submissions: enrichedSubmissions.length,
        graded: enrichedSubmissions.filter((s) => ['GRADED', 'REVIEWED', 'FINALIZED'].includes(s.status)).length,
        finalized: enrichedSubmissions.filter((s) => s.status === 'FINALIZED').length,
      },
      publish: {
        isPublishedToStudents: session.status === 'COMPLETED',
        canPublishToStudents: enrichedSubmissions.every((s) => s.finalScore !== null),
      },
      scoreStats: {
        average: Number(average.toFixed(2)),
        min,
        max,
      },
      submissions: enrichedSubmissions,
    });
  } catch (error) {
    console.error('Get session report error:', error);
    res.status(500).json({ error: 'Failed to get session report' });
  }
};

const csvEscape = (value: unknown): string => {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

export const exportSessionReportCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        class: { select: { id: true, name: true } },
        exam: { select: { id: true, title: true, teacherId: true } },
      },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId },
      include: {
        student: { select: { username: true, fullName: true } },
      },
      orderBy: { studentId: 'asc' },
    });

    const header = [
      'Session ID',
      'Exam Title',
      'Class',
      'Student Code',
      'Student Name',
      'Status',
      'AI Score',
      'Final Score',
      'Submitted At',
      'Scan URLs',
    ];

    const rows = submissions.map((item) => {
      const scanUrls = parseAccessibleScanEntries(item.scanFiles || '[]')
        .map((scan) => scan.accessUrl || '')
        .filter(Boolean)
        .join(' | ');

      return [
        session.id,
        session.exam.title,
        session.class.name,
        item.student.username,
        item.student.fullName,
        item.status,
        item.aiScore ?? '',
        item.finalScore ?? '',
        item.submittedAt.toISOString(),
        scanUrls,
      ];
    });

    const csv = [header, ...rows]
      .map((line) => line.map((value) => csvEscape(value)).join(','))
      .join('\n');

    const safeExamTitle = session.exam.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'session_report';
    const filename = `session_${session.id}_${safeExamTitle}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Export session report csv error:', error);
    res.status(500).json({ error: 'Failed to export session report csv' });
  }
};

export const finalizeSessionReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: true },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId },
      select: {
        id: true,
        finalScore: true,
        aiScore: true,
        status: true,
      },
    });

    if (submissions.length === 0) {
      res.status(400).json({ error: 'No submissions found for this session' });
      return;
    }

    let autoFilledFromAiCount = 0;
    let autoFilledZeroCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const submission of submissions) {
        const finalizedScore = submission.finalScore ?? submission.aiScore ?? 0;

        if (submission.finalScore === null && submission.aiScore !== null) {
          autoFilledFromAiCount += 1;
        }
        if (submission.finalScore === null && submission.aiScore === null) {
          autoFilledZeroCount += 1;
        }

        await tx.examSubmission.update({
          where: { id: submission.id },
          data: {
            finalScore: finalizedScore,
            status: 'FINALIZED',
          },
        });

        await tx.gradingAuditLog.create({
          data: {
            submissionId: submission.id,
            actorId: req.user!.id,
            action: 'REPORT_CONFIRMED',
            beforeScore: submission.finalScore,
            afterScore: finalizedScore,
            note: 'Session report confirmed and published to students',
          },
        });
      }

      await tx.examSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
        },
      });
    });

    res.json({
      message: 'Report confirmed and results published to students',
      sessionId,
      totalSubmissions: submissions.length,
      autoFilledFromAiCount,
      autoFilledZeroCount,
      published: true,
    });
  } catch (error) {
    console.error('Finalize session report error:', error);
    res.status(500).json({ error: 'Failed to finalize session report' });
  }
};

export const completeScanningAndAutoGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: {
          include: {
            questions: {
              include: { question: true },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId },
      select: {
        id: true,
        scanFiles: true,
        student: {
          select: { id: true, fullName: true, username: true },
        },
      },
    });

    const essayExamQuestions = session.exam.questions.filter((item) => item.question.type === 'ESSAY');
    const mcqExamQuestions = session.exam.questions.filter((item) => item.question.type === 'MULTIPLE_CHOICE');

    const essayQuestionsForGemini = essayExamQuestions.map((item) => ({
      questionId: item.question.id,
      questionContent: item.question.content,
      expectedAnswer: item.question.answer,
      rubric: item.question.rubric,
      maxScore: item.points,
    }));

    // Determine batch size: target 8-10 images per Gemini request
    const batchSize = computeMultiStudentBatchSize(essayExamQuestions.length, expectedPages);

    let gradedCount = 0;
    let failedCount = 0;
    let identityCheckedCount = 0;
    let identityMismatchCount = 0;
    const results: Array<{
      submissionId: number;
      studentId: number;
      studentName: string;
      studentCode: string;
      objectiveScore: number;
      essayScore: number;
      totalScore: number;
      warnings: string[];
      status: 'GRADED' | 'FAILED';
      error?: string;
    }> = [];

    // Separate submissions with scans from those without
    type GradableSubmission = {
      submission: typeof submissions[0];
      scanEntries: ScanEntry[];
    };

    const gradableSubmissions: GradableSubmission[] = [];
    for (const submission of submissions) {
      const scanEntries = parseScanEntries(submission.scanFiles || '[]');
      if (scanEntries.length === 0) {
        // No scans → mark failed immediately
        results.push({
          submissionId: submission.id,
          studentId: submission.student.id,
          studentName: submission.student.fullName,
          studentCode: submission.student.username,
          objectiveScore: 0,
          essayScore: 0,
          totalScore: 0,
          warnings: [],
          status: 'FAILED',
          error: 'No scan files uploaded',
        });
        failedCount += 1;
        continue;
      }
      gradableSubmissions.push({ submission, scanEntries });
    }

    // Process OMR first (per-student, as it uses OpenCV locally)
    const omrResultsBySubmissionId = new Map<number, Record<string, string>>();
    const omrObjectiveScoreBySubmissionId = new Map<number, number>();

    if (mcqExamQuestions.length > 0) {
      for (const { submission, scanEntries } of gradableSubmissions) {
        try {
          const firstScan = scanEntries.sort((a, b) => {
            const ai = Number(a.passIndex) || 999;
            const bi = Number(b.passIndex) || 999;
            return ai - bi;
          })[0];
          const scanPath = await resolveScanPath(firstScan);
          const preprocessed = await preprocessScanForAnalysis(scanPath);
          try {
            const detection = await detectDocumentForOmr(preprocessed.processedPath);
            const omrTemplate = scanBlueprint.omrTemplate;
            if (omrTemplate) {
              const calibrated = calibrateOmrTemplate(omrTemplate, detection);
              const detected = await detectMarkedOptions(preprocessed.processedPath, calibrated);
              omrResultsBySubmissionId.set(submission.id, detected);

              let objectiveScore = 0;
              for (const eq of mcqExamQuestions) {
                const submitted = (detected[String(eq.question.id)] || '').trim().toLowerCase();
                const expected = (eq.question.answer || '').trim().toLowerCase();
                if (submitted && submitted === expected) objectiveScore += eq.points;
              }
              omrObjectiveScoreBySubmissionId.set(submission.id, objectiveScore);
            }
          } finally {
            preprocessed.cleanup();
          }
          if (path.basename(scanPath).startsWith('scan_tmp_')) {
            fs.unlink(scanPath, () => undefined);
          }
        } catch (omrError) {
          // OMR failure is non-fatal; score stays 0 for objective
          omrObjectiveScoreBySubmissionId.set(submission.id, 0);
        }
      }
    }

    // Process essay grading in multi-student batches
    if (essayExamQuestions.length > 0) {
      for (let i = 0; i < gradableSubmissions.length; i += batchSize) {
        const batch = gradableSubmissions.slice(i, i + batchSize);

        // Prepare scan paths for each student in this batch
        const batchInputs: MultiStudentBatchInput[] = [];
        const batchSubmissions: typeof batch = [];

        for (const item of batch) {
          try {
            const orderedScans = [...item.scanEntries].sort((a, b) => {
              const ai = Number(a.passIndex) || 999;
              const bi = Number(b.passIndex) || 999;
              return ai - bi;
            });

            const scanPaths: string[] = [];
            for (const entry of orderedScans) {
              scanPaths.push(await resolveScanPath(entry));
            }

            const normalizedScannablePages = normalizePositiveInt(scanBlueprint?.scannablePages, scanPaths.length);
            const gradingScanPaths = scanPaths.slice(0, normalizedScannablePages);

            batchInputs.push({
              studentLabel: `SUB_${item.submission.id}`,
              scanPaths: gradingScanPaths,
            });
            batchSubmissions.push(item);
          } catch (prepError) {
            failedCount += 1;
            results.push({
              submissionId: item.submission.id,
              studentId: item.submission.student.id,
              studentName: item.submission.student.fullName,
              studentCode: item.submission.student.username,
              objectiveScore: omrObjectiveScoreBySubmissionId.get(item.submission.id) || 0,
              essayScore: 0,
              totalScore: omrObjectiveScoreBySubmissionId.get(item.submission.id) || 0,
              warnings: [],
              status: 'FAILED',
              error: (prepError as Error).message,
            });
          }
        }

        if (batchInputs.length === 0) continue;

        try {
          const batchResults = await extractAndGradeMultiStudentBatch(
            batchInputs,
            essayQuestionsForGemini,
            expectedPages,
            passPlan.passPurposeByIndex as Record<string, string>,
            scanBlueprint as any,
          );

          for (let j = 0; j < batchSubmissions.length; j++) {
            const sub = batchSubmissions[j].submission;
            const result = batchResults[j];
            const objectiveScore = omrObjectiveScoreBySubmissionId.get(sub.id) || 0;
            const essayScore = result ? result.essayResults.reduce((acc, r) => acc + r.score, 0) : 0;
            const totalScore = Number((objectiveScore + essayScore).toFixed(2));

            const objectiveAnswers = omrResultsBySubmissionId.get(sub.id) || {};
            const essayAnswers = result?.essayAnswers || {};
            const essayResults = result?.essayResults || [];
            const warnings = result?.warnings || [];
            const extractedIdentity = result ? { fullName: result.fullName, studentCode: result.studentCode } : null;

            let identityCheck: { nameMatch: boolean; codeMatch: boolean } | null = null;
            if (extractedIdentity) {
              const expectedName = (sub.student.fullName || '').trim().toLowerCase();
              const expectedCode = normalizeStudentCode(sub.student.username);
              const foundName = (extractedIdentity.fullName || '').trim().toLowerCase();
              const foundCode = normalizeStudentCode(extractedIdentity.studentCode);
              identityCheck = {
                nameMatch: !!foundName && expectedName.includes(foundName),
                codeMatch: !!foundCode && expectedCode === foundCode,
              };
              identityCheckedCount += 1;
              if (!identityCheck.nameMatch || !identityCheck.codeMatch) {
                identityMismatchCount += 1;
                warnings.push('Student identity extracted from scan does not fully match enrollment data');
              }
            }

            const feedbackPayload = {
              identity: extractedIdentity,
              identityCheck,
              objectiveScore,
              essayScore,
              totalScore,
              objectiveAnswers,
              essayAnswers,
              essayResults,
              aiComments: essayResults.length > 0 ? 'Đã chấm trắc nghiệm bằng OMR cục bộ và tự luận bằng AI (multi-student batch).' : null,
              warnings: [...new Set(warnings)],
              scanBlueprint: { scannablePages: scanBlueprint.scannablePages, passPurposeByIndex: scanBlueprint.passPurposeByIndex },
            };

            try {
              await prisma.$transaction(async (tx) => {
                await tx.submissionGrade.create({
                  data: {
                    submissionId: sub.id,
                    graderId: req.user!.id,
                    method: 'AI',
                    objectiveScore,
                    essayScore,
                    totalScore,
                    rubricVersion: `exam-v${session.exam.version}`,
                    responseLog: JSON.stringify(feedbackPayload),
                  },
                });
                await tx.gradingAuditLog.create({
                  data: {
                    submissionId: sub.id,
                    actorId: req.user!.id,
                    action: 'AI_GRADED',
                    beforeScore: null,
                    afterScore: totalScore,
                    note: JSON.stringify({ batchMode: 'multi_student', batchSize: batchInputs.length }),
                  },
                });
                await tx.examSubmission.update({
                  where: { id: sub.id },
                  data: {
                    objectiveAnswers: JSON.stringify(objectiveAnswers),
                    essayAnswers: JSON.stringify(essayAnswers),
                    aiScore: totalScore,
                    finalScore: totalScore,
                    status: 'GRADED',
                    gradedAt: new Date(),
                    feedback: JSON.stringify(feedbackPayload),
                  },
                });
              });

              gradedCount += 1;
              results.push({
                submissionId: sub.id,
                studentId: sub.student.id,
                studentName: sub.student.fullName,
                studentCode: sub.student.username,
                objectiveScore,
                essayScore,
                totalScore,
                warnings,
                status: 'GRADED',
              });
            } catch (dbError) {
              failedCount += 1;
              results.push({
                submissionId: sub.id,
                studentId: sub.student.id,
                studentName: sub.student.fullName,
                studentCode: sub.student.username,
                objectiveScore: 0,
                essayScore: 0,
                totalScore: 0,
                warnings: [],
                status: 'FAILED',
                error: (dbError as Error).message,
              });
            }
          }
        } catch (batchError) {
          // If the entire batch fails, fall back to individual grading
          for (const item of batchSubmissions) {
            try {
              const gradingReq = {
                ...req,
                params: { ...req.params, submissionId: String(item.submission.id) },
                body: { useScanExtraction: true },
              } as unknown as AuthRequest;
              const capture: { statusCode: number; payload: unknown } = { statusCode: 200, payload: null };
              const gradingRes = {
                status(code: number) { capture.statusCode = code; return this; },
                json(payload: unknown) { capture.payload = payload; return this; },
              } as unknown as Response;
              await gradeSubmissionWithAI(gradingReq, gradingRes);

              if (capture.statusCode >= 400) {
                failedCount += 1;
                results.push({
                  submissionId: item.submission.id,
                  studentId: item.submission.student.id,
                  studentName: item.submission.student.fullName,
                  studentCode: item.submission.student.username,
                  objectiveScore: 0, essayScore: 0, totalScore: 0,
                  warnings: [], status: 'FAILED',
                  error: (capture.payload as { error?: string })?.error || 'Grading failed',
                });
              } else {
                gradedCount += 1;
                const payload = capture.payload as { finalScore?: number | null; grades?: Array<{ objectiveScore: number; essayScore: number; totalScore: number }> };
                const grade = payload?.grades?.[0];
                results.push({
                  submissionId: item.submission.id,
                  studentId: item.submission.student.id,
                  studentName: item.submission.student.fullName,
                  studentCode: item.submission.student.username,
                  objectiveScore: grade?.objectiveScore || 0,
                  essayScore: grade?.essayScore || 0,
                  totalScore: grade?.totalScore || payload?.finalScore || 0,
                  warnings: [], status: 'GRADED',
                });
              }
            } catch (fallbackError) {
              failedCount += 1;
              results.push({
                submissionId: item.submission.id,
                studentId: item.submission.student.id,
                studentName: item.submission.student.fullName,
                studentCode: item.submission.student.username,
                objectiveScore: 0, essayScore: 0, totalScore: 0,
                warnings: [], status: 'FAILED',
                error: (fallbackError as Error).message,
              });
            }
          }
        }
      }
    } else {
      // No essay questions - just OMR scoring
      for (const { submission } of gradableSubmissions) {
        const objectiveScore = omrObjectiveScoreBySubmissionId.get(submission.id) || 0;
        const objectiveAnswers = omrResultsBySubmissionId.get(submission.id) || {};

        try {
          await prisma.$transaction(async (tx) => {
            await tx.submissionGrade.create({
              data: {
                submissionId: submission.id,
                graderId: req.user!.id,
                method: 'AI',
                objectiveScore,
                essayScore: 0,
                totalScore: objectiveScore,
                responseLog: JSON.stringify({ objectiveAnswers }),
              },
            });
            await tx.examSubmission.update({
              where: { id: submission.id },
              data: {
                objectiveAnswers: JSON.stringify(objectiveAnswers),
                aiScore: objectiveScore,
                finalScore: objectiveScore,
                status: 'GRADED',
                gradedAt: new Date(),
                feedback: JSON.stringify({ objectiveScore, totalScore: objectiveScore, objectiveAnswers }),
              },
            });
          });
          gradedCount += 1;
          results.push({
            submissionId: submission.id,
            studentId: submission.student.id,
            studentName: submission.student.fullName,
            studentCode: submission.student.username,
            objectiveScore,
            essayScore: 0,
            totalScore: objectiveScore,
            warnings: [],
            status: 'GRADED',
          });
        } catch (err) {
          failedCount += 1;
          results.push({
            submissionId: submission.id,
            studentId: submission.student.id,
            studentName: submission.student.fullName,
            studentCode: submission.student.username,
            objectiveScore: 0, essayScore: 0, totalScore: 0,
            warnings: [], status: 'FAILED',
            error: (err as Error).message,
          });
        }
      }
    }

    await prisma.examSession.update({
      where: { id: sessionId },
      data: {
        status: 'GRADING',
        endedAt: null,
      },
    });

    res.json({
      message: `Scanning completed. ${gradedCount} graded (batch size: ${batchSize} students/request), ${failedCount} failed.`,
      gradedCount,
      failedCount,
      identityCheckedCount,
      identityMismatchCount,
      batchSize,
      totalSubmissions: submissions.length,
      reportUrl: `/api/exams/sessions/${sessionId}/report`,
      reportExportUrl: `/api/exams/sessions/${sessionId}/report/export`,
      publishHint: 'Run report confirmation to finalize and publish scores to student portal.',
      results,
    });
  } catch (error) {
    console.error('Complete scanning and auto grade error:', error);
    res.status(500).json({ error: 'Failed to complete scanning workflow' });
  }
};

export const getMyPublishedExamResults = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.user!.id;

    const rows = await prisma.examSubmission.findMany({
      where: {
        studentId,
        status: 'FINALIZED',
        session: {
          status: 'COMPLETED',
        },
      },
      include: {
        session: {
          include: {
            class: { select: { id: true, name: true } },
            exam: { select: { id: true, title: true, examType: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(
      rows.map((item) => ({
        submissionId: item.id,
        examId: item.session.exam.id,
        examTitle: item.session.exam.title,
        examType: item.session.exam.examType,
        classId: item.session.class.id,
        className: item.session.class.name,
        finalScore: item.finalScore,
        aiScore: item.aiScore,
        status: item.status,
        gradedAt: item.gradedAt,
        publishedAt: item.updatedAt,
      }))
    );
  } catch (error) {
    console.error('Get published exam results error:', error);
    res.status(500).json({ error: 'Failed to get published exam results' });
  }
};

export const listTeacherSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessions = await prisma.examSession.findMany({
      where: {
        exam: {
          teacherId: req.user!.id,
        },
      },
      include: {
        class: { select: { id: true, name: true } },
        exam: {
          select: {
            id: true,
            title: true,
            examType: true,
            durationMinutes: true,
            version: true,
          },
        },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(sessions);
  } catch (error) {
    console.error('List teacher sessions error:', error);
    res.status(500).json({ error: 'Failed to list exam sessions' });
  }
};

export const exportExamAnswerKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examId = toInt(req.params.examId);
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        subject: true,
        questions: {
          include: { question: { include: { learningOutcome: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!exam || exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    const questionList = exam.questions.map((item) => item.question);
    const essayQuestions = questionList.filter((item) => item.type === 'ESSAY');
    const mcqQuestions = questionList.filter((item) => item.type === 'MULTIPLE_CHOICE');

    const pointsMap = new Map<number, number>();
    for (const eq of exam.questions) {
      pointsMap.set(eq.questionId, Number(eq.points) || 0);
    }

    const docBuffer = await generateAnswerKeyDocx(
      exam.subject.name,
      exam.durationMinutes,
      mcqQuestions,
      essayQuestions,
      pointsMap
    );

    const filename = `answer_key_${exam.subject.name.replace(/\s+/g, '_')}_${exam.id}_v${exam.version}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(docBuffer);
  } catch (error) {
    console.error('Export exam answer key error:', error);
    res.status(500).json({ error: 'Failed to export answer key' });
  }
};

export const uploadBulkExamScans = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);
    const files = sortUploadedScanFiles(((req as AuthRequest & { files?: Express.Multer.File[] }).files || []) as Express.Multer.File[]);

    if (files.length === 0) {
      res.status(400).json({ error: 'At least one scan file is required' });
      return;
    }

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: {
          include: {
            questions: {
              include: { question: { select: { id: true, type: true } } },
              orderBy: { position: 'asc' },
            },
          },
        },
        class: true,
      },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const pagesPerStudent = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    if (!Number.isFinite(pagesPerStudent) || pagesPerStudent <= 0) {
      throw createHttpError(400, 'Exam scannable page count is invalid. Please export exam again before scanning.', {
        errorCode: 'INVALID_PAGE_COUNT',
      });
    }

    if (files.length % pagesPerStudent !== 0) {
      res.status(400).json({
        error: `The number of uploaded images must be a multiple of the exam's scannable pages (${pagesPerStudent}).`,
      });
      return;
    }

    const invalidScans = await collectInvalidScans(files, 1);
    const invalidScanGroups = new Map<number, InvalidScanDetail[]>();
    for (const scan of invalidScans) {
      const passIndex = Number(scan.passIndex);
      if (!Number.isFinite(passIndex) || passIndex <= 0) continue;
      const groupIndex = Math.ceil(passIndex / pagesPerStudent);
      const groupScans = invalidScanGroups.get(groupIndex) || [];
      groupScans.push(scan);
      invalidScanGroups.set(groupIndex, groupScans);
    }

    await ensureSessionSubmissionRows(sessionId, session.classId);

    const enrolledStudents = await prisma.classStudent.findMany({
      where: { classId: session.classId },
      select: {
        student: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (enrolledStudents.length === 0) {
      res.status(400).json({ error: 'No enrolled students found in this class' });
      return;
    }

    const studentList = enrolledStudents.map((item) => item.student);

    // Group every N pages into one student submission package.
    const studentSets: Express.Multer.File[][] = [];
    for (let i = 0; i < files.length; i += pagesPerStudent) {
      studentSets.push(files.slice(i, i + pagesPerStudent));
    }

    const studentSubmissionGroups = studentSets.map((set, index) => ({
      groupIndex: index + 1,
      scannablePages: set.length,
      files: set.map((file) => file.originalname || file.filename),
    }));

    type ClassificationResult = {
      studentId: number;
      studentName: string;
      studentCode: string;
      submissionId: number;
      pagesAssigned: number;
      status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'QUALITY_FAIL';
      confidence: string;
      warnings: string[];
    };

    const classifications: ClassificationResult[] = [];
    const unmatchedFiles: string[] = [];
    let matchedCount = 0;
    let ambiguousCount = 0;
    let unmatchedCount = 0;
    let qualityFailedCount = 0;
    const usedStudentIds = new Set<number>();

    for (const [setIndex, fileSet] of studentSets.entries()) {
      if (fileSet.length === 0) continue;

      const firstFile = fileSet[0];
      let resolvedStudentId: number | null = null;
      let extractedIdentity: { fullName: string | null; studentCode: string | null } | null = null;
      let classificationStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'QUALITY_FAIL' = 'UNMATCHED';
      const classificationWarnings: string[] = [];
      const groupInvalidScans = invalidScanGroups.get(setIndex + 1) || [];

      if (groupInvalidScans.length > 0) {
        classificationStatus = 'QUALITY_FAIL';
        qualityFailedCount += 1;
        classificationWarnings.push(
          ...groupInvalidScans.map((scan) => {
            const reasonText = scan.reasons.join(', ');
            return `Page ${scan.passIndex || '?'}: ${reasonText}`;
          })
        );
      }

      // Try to extract identity from first page
      try {
        extractedIdentity = await extractStudentIdentityFromOmr(firstFile.path);

        const availableStudents = studentList.filter((s) => !usedStudentIds.has(s.id));
        const resolved = resolveStudentFromIdentity(availableStudents, extractedIdentity);

        if (resolved.matched) {
          resolvedStudentId = resolved.matched.id;
          if (classificationStatus !== 'QUALITY_FAIL') {
            classificationStatus = 'MATCHED';
            matchedCount += 1;
          }
        } else if (resolved.ambiguous.length > 0) {
          if (classificationStatus !== 'QUALITY_FAIL') {
            classificationStatus = 'AMBIGUOUS';
            ambiguousCount += 1;
          }
          classificationWarnings.push(`Ambiguous match: ${resolved.ambiguous.map((s) => s.fullName).join(', ')}`);
        } else {
          if (classificationStatus !== 'QUALITY_FAIL') {
            classificationStatus = 'UNMATCHED';
            unmatchedCount += 1;
          }
          classificationWarnings.push('No matching student found');
        }
      } catch (error) {
        if (classificationStatus !== 'QUALITY_FAIL') {
          classificationStatus = 'UNMATCHED';
          unmatchedCount += 1;
        }
        classificationWarnings.push(mapTeacherFacingErrorMessage(error, TEACHER_IDENTITY_MESSAGE));
      }

      if (resolvedStudentId) {
        usedStudentIds.add(resolvedStudentId);

        try {
          const { submission } = await persistSubmissionScans({
            sessionId,
            studentId: resolvedStudentId,
            files: fileSet,
            replaceExisting: true,
            sequentialPasses: true,
            totalPasses: pagesPerStudent,
            passPurposeResolver: (passIdx: number) => getScanPassPurpose(passIdx, passPlan),
          });

          classifications.push({
            studentId: resolvedStudentId,
            studentName: studentList.find((s) => s.id === resolvedStudentId)?.fullName || '',
            studentCode: studentList.find((s) => s.id === resolvedStudentId)?.username || '',
            submissionId: submission.id,
            pagesAssigned: fileSet.length,
            status: classificationStatus,
            confidence: extractedIdentity ? 'high' : 'low',
            warnings: classificationWarnings,
          });
        } catch (persistError) {
          classificationWarnings.push(`Failed to save scans: ${(persistError as Error).message}`);
          classifications.push({
            studentId: resolvedStudentId,
            studentName: studentList.find((s) => s.id === resolvedStudentId)?.fullName || '',
            studentCode: studentList.find((s) => s.id === resolvedStudentId)?.username || '',
            submissionId: 0,
            pagesAssigned: fileSet.length,
            status: classificationStatus,
            confidence: 'none',
            warnings: classificationWarnings,
          });
        }
      } else {
        for (const file of fileSet) {
          unmatchedFiles.push(file.originalname || file.filename);
          // Clean up unmatched files
          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
        classifications.push({
          studentId: 0,
          studentName: extractedIdentity?.fullName || 'Unknown',
          studentCode: extractedIdentity?.studentCode || 'Unknown',
          submissionId: 0,
          pagesAssigned: fileSet.length,
          status: classificationStatus,
          confidence: 'none',
          warnings: classificationWarnings,
        });
      }
    }

    res.status(201).json({
      message: `Bulk upload completed: ${matchedCount} matched, ${ambiguousCount} ambiguous, ${qualityFailedCount} quality-failed, ${unmatchedCount} unmatched`,
      totalImages: files.length,
      scannablePagesPerSubmission: pagesPerStudent,
      submissionGroups: studentSubmissionGroups,
      matched: matchedCount,
      ambiguous: ambiguousCount,
      qualityFailed: qualityFailedCount,
      unmatched: unmatchedCount,
      classifications,
      unmatchedFiles,
    });
  } catch (error) {
    const httpError = error as HttpError;
    const message = mapTeacherFacingErrorMessage(error, 'Failed to process bulk upload');

    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: message, ...(httpError.payload as Record<string, unknown> || {}) });
      return;
    }

    const geminiStatus = getGeminiErrorStatusCode(error);
    if (geminiStatus === 429 || geminiStatus === 503) {
      res.status(geminiStatus).json({ error: message });
      return;
    }

    console.error('Bulk upload exam scans error:', error);
    res.status(500).json({ error: message });
  }
};

export const getSessionIssuesReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = toInt(req.params.sessionId);

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: {
          include: {
            questions: {
              include: { question: { select: { id: true, type: true } } },
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!session || session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(session.exam.questions, session.exam.requirements);
    const passPlan = buildScanPassPlan(session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(session.exam.scannablePages, passPlan, scanBlueprint);

    await ensureSessionSubmissionRows(sessionId, session.classId);

    const submissions = await prisma.examSubmission.findMany({
      where: { sessionId },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
      },
    });

    type SessionIssue = {
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
    };

    const issues: SessionIssue[] = [];
    let missingExamsCount = 0;
    let incompletePagesCount = 0;
    let unreadableImagesCount = 0;
    let identityMismatchCount = 0;
    let readyForGrading = 0;

    for (const submission of submissions) {
      const scanEntries = parseScanEntries(submission.scanFiles || '[]');
      const scanCount = scanEntries.length;
      const submissionWarnings: string[] = [];

      // Check for missing exam
      if (scanCount === 0) {
        missingExamsCount += 1;
        issues.push({
          submissionId: submission.id,
          studentId: submission.studentId,
          studentName: submission.student?.fullName || '',
          studentCode: submission.student?.username || '',
          issueType: 'MISSING_EXAM',
          description: 'No scan images uploaded for this student',
          pagesExpected: expectedPages,
          pagesReceived: 0,
          missingPages: Array.from({ length: expectedPages }, (_, i) => i + 1),
          warnings: [],
        });
        continue;
      }

      // Check for incomplete pages
      const receivedPassIndices = new Set(
        scanEntries
          .map((e) => Number(e.passIndex))
          .filter((idx) => Number.isFinite(idx) && idx > 0)
      );

      const missingPages: number[] = [];
      for (let i = 1; i <= expectedPages; i++) {
        if (!receivedPassIndices.has(i)) {
          missingPages.push(i);
        }
      }

      if (missingPages.length > 0) {
        incompletePagesCount += 1;
        issues.push({
          submissionId: submission.id,
          studentId: submission.studentId,
          studentName: submission.student?.fullName || '',
          studentCode: submission.student?.username || '',
          issueType: 'INCOMPLETE_PAGES',
          description: `Missing ${missingPages.length} of ${expectedPages} pages: ${missingPages.join(', ')}`,
          pagesExpected: expectedPages,
          pagesReceived: scanCount,
          missingPages,
          warnings: submissionWarnings,
        });
        continue;
      }

      // Check feedback for unreadable warnings
      let feedbackWarnings: string[] = [];
      try {
        const parsedFeedback = JSON.parse(submission.feedback || '{}') as { warnings?: string[] };
        feedbackWarnings = Array.isArray(parsedFeedback.warnings) ? parsedFeedback.warnings : [];
      } catch {
        feedbackWarnings = [];
      }

      const hasUnreadableWarning = feedbackWarnings.some(
        (w) => w.toLowerCase().includes('unreadable') || w.toLowerCase().includes('failed to extract') || w.toLowerCase().includes('failed to analyze')
      );

      if (hasUnreadableWarning) {
        unreadableImagesCount += 1;
        issues.push({
          submissionId: submission.id,
          studentId: submission.studentId,
          studentName: submission.student?.fullName || '',
          studentCode: submission.student?.username || '',
          issueType: 'UNREADABLE_IMAGE',
          description: 'One or more scan images could not be read during grading',
          pagesExpected: expectedPages,
          pagesReceived: scanCount,
          missingPages: [],
          warnings: feedbackWarnings,
        });
        continue;
      }

      // Check identity mismatch
      const hasIdentityMismatch = feedbackWarnings.some(
        (w) => w.toLowerCase().includes('identity') && w.toLowerCase().includes('mismatch')
      );

      if (hasIdentityMismatch) {
        identityMismatchCount += 1;
        issues.push({
          submissionId: submission.id,
          studentId: submission.studentId,
          studentName: submission.student?.fullName || '',
          studentCode: submission.student?.username || '',
          issueType: 'IDENTITY_MISMATCH',
          description: 'Extracted student identity does not match enrollment data',
          pagesExpected: expectedPages,
          pagesReceived: scanCount,
          missingPages: [],
          warnings: feedbackWarnings,
        });
        continue;
      }

      readyForGrading += 1;
    }

    res.json({
      sessionId,
      totalStudents: submissions.length,
      studentsWithIssues: issues.length,
      issues,
      readyForGrading,
      summary: {
        missingExams: missingExamsCount,
        incompletePages: incompletePagesCount,
        unreadableImages: unreadableImagesCount,
        identityMismatches: identityMismatchCount,
      },
    });
  } catch (error) {
    console.error('Get session issues report error:', error);
    res.status(500).json({ error: 'Failed to get session issues report' });
  }
};

export const regradeStudentSubmission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const submissionId = toInt(req.params.submissionId);

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        student: { select: { id: true, fullName: true, username: true } },
        session: {
          include: {
            exam: {
              include: {
                questions: {
                  include: { question: true },
                  orderBy: { position: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!submission || submission.session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    const scanEntries = parseScanEntries(submission.scanFiles || '[]');

    if (scanEntries.length === 0) {
      res.status(400).json({ error: 'No scan files found. Upload scans before regrading.' });
      return;
    }

    const previousScore = submission.finalScore;
    const scanBlueprint = resolveExamScanBlueprint(submission.session.exam.questions, submission.session.exam.requirements);

    const warnings: string[] = [];
    const objectiveAnswers: Record<string, string> = {};
    const essayAnswers: Record<string, string> = {};

    const batchExtraction = await extractBatchScanGradingData(
      scanEntries,
      submission.session.exam.questions,
      scanBlueprint
    );
    Object.assign(objectiveAnswers, batchExtraction.objectiveAnswers);
    Object.assign(essayAnswers, batchExtraction.essayAnswers);
    warnings.push(...batchExtraction.warnings);

    let objectiveScore = 0;

    for (const examQuestion of submission.session.exam.questions) {
      const question = examQuestion.question;
      const key = String(question.id);

      if (question.type === 'ESSAY') {
        continue;
      }

      const submitted = (objectiveAnswers[key] || '').trim().toLowerCase();
      const expected = (question.answer || '').trim().toLowerCase();
      if (submitted && submitted === expected) {
        objectiveScore += examQuestion.points;
      }
    }

    const essayResults = batchExtraction.essayResults;

    const essayScore = essayResults.reduce((acc, item) => acc + item.score, 0);
    const totalScore = Number((objectiveScore + essayScore).toFixed(2));

    const feedbackPayload = {
      objectiveScore,
      essayScore,
      totalScore,
      objectiveAnswers,
      essayAnswers,
      essayResults,
      warnings: [...new Set(warnings)],
      regraded: true,
      previousScore,
    };

    await prisma.$transaction(async (tx) => {
      await tx.submissionGrade.create({
        data: {
          submissionId: submission.id,
          graderId: req.user!.id,
          method: 'AI',
          objectiveScore,
          essayScore,
          totalScore,
          rubricVersion: `exam-v${submission.session.exam.version}-regrade`,
          responseLog: JSON.stringify(feedbackPayload),
        },
      });

      await tx.gradingAuditLog.create({
        data: {
          submissionId: submission.id,
          actorId: req.user!.id,
          action: 'REGRADED',
          beforeScore: previousScore,
          afterScore: totalScore,
          note: JSON.stringify({ regradeReason: 'Manual regrade triggered by teacher' }),
        },
      });

      await tx.examSubmission.update({
        where: { id: submission.id },
        data: {
          objectiveAnswers: JSON.stringify(objectiveAnswers),
          essayAnswers: JSON.stringify(essayAnswers),
          aiScore: totalScore,
          finalScore: totalScore,
          status: 'GRADED',
          gradedAt: new Date(),
          feedback: JSON.stringify(feedbackPayload),
        },
      });
    });

    res.json({
      submissionId: submission.id,
      studentName: submission.student?.fullName || '',
      previousScore,
      newScore: totalScore,
      objectiveScore,
      essayScore,
      warnings: [...new Set(warnings)],
      status: 'GRADED',
    });
  } catch (error) {
    const httpError = error as HttpError;
    const message = mapTeacherFacingErrorMessage(error, 'Failed to regrade submission');

    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: message, ...(httpError.payload as Record<string, unknown> || {}) });
      return;
    }

    const geminiStatus = getGeminiErrorStatusCode(error);
    if (geminiStatus === 429 || geminiStatus === 503) {
      res.status(geminiStatus).json({ error: message });
      return;
    }

    console.error('Regrade student submission error:', error);
    res.status(500).json({ error: message });
  }
};

export const uploadMissingPages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const submissionId = toInt(req.params.submissionId);
    const files = ((req as AuthRequest & { files?: Express.Multer.File[] }).files || []) as Express.Multer.File[];

    if (files.length === 0) {
      res.status(400).json({ error: 'At least one scan file is required' });
      return;
    }

    const submission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      include: {
        student: { select: { id: true, fullName: true, username: true } },
        session: {
          include: {
            exam: {
              include: {
                questions: {
                  include: { question: { select: { id: true, type: true } } },
                  orderBy: { position: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!submission || submission.session.exam.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    const scanBlueprint = resolveExamScanBlueprint(submission.session.exam.questions, submission.session.exam.requirements);
    const passPlan = buildScanPassPlan(submission.session.exam.questions, scanBlueprint);
    const expectedPages = resolveExpectedScannablePages(submission.session.exam.scannablePages, passPlan, scanBlueprint);

    if (!Number.isFinite(expectedPages) || expectedPages <= 0) {
      res.status(400).json({ error: 'Exam scannable page count is invalid. Please export exam again before scanning.' });
      return;
    }

    // Determine which pages are missing
    const existingScans = parseScanEntries(submission.scanFiles || '[]');
    const existingPassIndices = new Set(
      existingScans
        .map((e) => Number(e.passIndex))
        .filter((idx) => Number.isFinite(idx) && idx > 0)
    );

    const missingPages: number[] = [];
    for (let i = 1; i <= expectedPages; i++) {
      if (!existingPassIndices.has(i)) {
        missingPages.push(i);
      }
    }

    const qualityBasePass = missingPages.length > 0 ? missingPages[0] : 1;
    const invalidScans = await collectInvalidScans(files, qualityBasePass);
    if (invalidScans.length > 0) {
      throw createHttpError(422, TEACHER_QUALITY_MESSAGE, {
        errorCode: 'QUALITY_FAIL',
        invalidScans,
        requiresRetake: true,
      });
    }

    if (missingPages.length === 0 && files.length > 0) {
      // All pages present — treat as replacement upload for specific pages
      // Use sequential assignment starting from page 1
      const { submission: updated, mergedScans, mergedPdfUrl } = await persistSubmissionScans({
        sessionId: submission.sessionId,
        studentId: submission.studentId,
        files,
        replaceExisting: true,
        sequentialPasses: true,
        totalPasses: expectedPages,
        passPurposeResolver: (passIdx: number) => getScanPassPurpose(passIdx, passPlan),
      });

      res.status(201).json({
        submissionId: updated.id,
        studentName: submission.student?.fullName || '',
        pagesUploaded: files.length,
        scannablePages: expectedPages,
        isComplete: mergedScans.length >= expectedPages,
        mergedPdfUrl,
        scanEntries: mergedScans.map(toAccessibleScanEntry),
      });
      return;
    }

    // Assign files to missing pages in order
    const assignedPages: number[] = [];
    for (let i = 0; i < files.length && i < missingPages.length; i++) {
      const pageIndex = missingPages[i];
      assignedPages.push(pageIndex);

      await persistSubmissionScans({
        sessionId: submission.sessionId,
        studentId: submission.studentId,
        files: [files[i]],
        passIndex: pageIndex,
        totalPasses: expectedPages,
        purpose: getScanPassPurpose(pageIndex, passPlan),
      });
    }

    // Clean up any leftover files not assigned
    for (let i = missingPages.length; i < files.length; i++) {
      const file = files[i];
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    // Fetch updated submission
    const updatedSubmission = await prisma.examSubmission.findUnique({
      where: { id: submissionId },
      select: { scanFiles: true },
    });

    const updatedScans = parseScanEntries(updatedSubmission?.scanFiles || '[]');
    const isComplete = updatedScans.filter(
      (e) => Number.isFinite(Number(e.passIndex)) && Number(e.passIndex) > 0
    ).length >= expectedPages;

    res.status(201).json({
      submissionId,
      studentName: submission.student?.fullName || '',
      pagesUploaded: assignedPages.length,
      assignedPages,
      scannablePages: expectedPages,
      remainingMissing: missingPages.slice(assignedPages.length),
      isComplete,
      scanEntries: updatedScans.map(toAccessibleScanEntry),
    });
  } catch (error) {
    const httpError = error as HttpError;
    const message = mapTeacherFacingErrorMessage(error, 'Failed to upload missing pages');

    if (httpError.statusCode) {
      res.status(httpError.statusCode).json({ error: message, ...(httpError.payload as Record<string, unknown> || {}) });
      return;
    }

    const geminiStatus = getGeminiErrorStatusCode(error);
    if (geminiStatus === 429 || geminiStatus === 503) {
      res.status(geminiStatus).json({ error: message });
      return;
    }

    console.error('Upload missing pages error:', error);
    res.status(500).json({ error: message });
  }
};
