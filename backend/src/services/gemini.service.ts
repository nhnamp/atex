import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import { preprocessScanForAnalysis } from './image-preprocess.service';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const GEMINI_MIN_CALL_INTERVAL_MS = 15_000;
const GEMINI_BACKOFF_RETRY_MS = [30_000, 60_000] as const;

let geminiQueue: Promise<void> = Promise.resolve();
let lastGeminiCallStartedAt = 0;

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const parseStatusCode = (error: unknown): number | null => {
  const err = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };

  const candidates = [err.status, err.statusCode, err.response?.status, err.code];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }

  const message = String(err.message || '');
  const matched = message.match(/\b(429|503)\b/);
  if (matched) {
    return Number(matched[1]);
  }

  return null;
};

const isRetryableGeminiError = (error: unknown): boolean => {
  const statusCode = parseStatusCode(error);
  return statusCode === 429 || statusCode === 503;
};

const runWithGeminiBackoff = async <T>(operation: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; attempt <= GEMINI_BACKOFF_RETRY_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableGeminiError(error) || attempt >= GEMINI_BACKOFF_RETRY_MS.length) {
        throw error;
      }

      const delayMs = GEMINI_BACKOFF_RETRY_MS[attempt];
      await sleep(delayMs);
    }
  }

  throw new Error('Gemini request retry attempts exceeded');
};

const enqueueGeminiRequest = async <T>(operation: () => Promise<T>): Promise<T> => {
  const execute = async (): Promise<T> => {
    const elapsed = Date.now() - lastGeminiCallStartedAt;
    const waitMs = Math.max(0, GEMINI_MIN_CALL_INTERVAL_MS - elapsed);
    await sleep(waitMs);

    lastGeminiCallStartedAt = Date.now();
    return runWithGeminiBackoff(operation);
  };

  const task = geminiQueue.then(execute, execute);
  geminiQueue = task.then(
    () => undefined,
    () => undefined
  );

  return task;
};

const generateGeminiText = async (model: any, payload: unknown): Promise<string> => {
  const result = await enqueueGeminiRequest<any>(() => model.generateContent(payload as any));
  return String(result.response.text() || '').trim();
};

export interface EssayGradingResult {
  questionId: number;
  score: number;
  maxScore: number;
  feedback: string;
}

export interface ScanIdentityResult {
  fullName: string | null;
  studentCode: string | null;
}

export interface ScanLayoutBlueprint {
  scannablePages?: number;
  hasMcq?: boolean;
  passPurposeByIndex?: Record<string, string>;
  identityPlaceholders?: Array<{
    key: string;
    label: string;
    pageIndex: number;
    region?: { x: number; y: number; width: number; height: number };
  }>;
  markerAnchors?: Array<{
    questionId: number;
    markerCode: string;
    markerLabel?: string;
    answerStartMarker?: string;
    answerEndMarker?: string;
    passIndex?: number;
    pageIndex?: number;
    purpose?: string;
  }>;
}

export interface SubmissionBatchEssayQuestion {
  questionId: number;
  questionContent: string;
  expectedAnswer: string;
  rubric?: string | null;
  maxScore: number;
}

export interface SubmissionBatchExtractionInput {
  scanPaths: string[];
  scannablePages: number;
  layoutBlueprint?: ScanLayoutBlueprint;
  passPurposeByIndex?: Record<string, string>;
  essayQuestions: SubmissionBatchEssayQuestion[];
}

export interface SubmissionBatchExtractionResult {
  fullName: string | null;
  studentCode: string | null;
  essayAnswers: Record<string, string>;
  essayResults: EssayGradingResult[];
  warnings: string[];
}

const parseModelJson = <T>(rawText: string): T => {
  const cleaned = rawText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  return JSON.parse(cleaned) as T;
};

export const extractStudentIdentityFromScan = async (
  scanPath: string,
  layoutBlueprint?: ScanLayoutBlueprint
): Promise<ScanIdentityResult> => {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  if (!fs.existsSync(scanPath)) {
    throw new Error('Scan file not found');
  }

  const preprocessed = await preprocessScanForAnalysis(scanPath);
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const ext = path.extname(preprocessed.processedPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const imageBase64 = fs.readFileSync(preprocessed.processedPath).toString('base64');

  const identityPlaceholders = Array.isArray(layoutBlueprint?.identityPlaceholders)
    ? layoutBlueprint?.identityPlaceholders
    : [];

  try {
    const rawText = await generateGeminiText(model, [
      {
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      },
      `You are extracting student identity from a scanned exam sheet.

  Priority rules:
  1. Use exam layout placeholders if available.
  2. Prefer exact student code from identity area over any other numeric text.
  3. Do not guess. If unreadable, return null.

  Layout blueprint (identity placeholders):
  ${JSON.stringify(identityPlaceholders, null, 2)}

  Return only valid JSON in this exact format:
  {"fullName":"... or null","studentCode":"... or null"}`,
    ]);

    const parsed = parseModelJson<ScanIdentityResult>(rawText);
    return {
      fullName: parsed?.fullName ? String(parsed.fullName).trim() : null,
      studentCode: parsed?.studentCode ? String(parsed.studentCode).trim() : null,
    };
  } finally {
    preprocessed.cleanup();
  }
};

const normalizeEssayAnswers = (answers: unknown): Record<string, string> => {
  if (!answers || typeof answers !== 'object') return {};

  const result: Record<string, string> = {};
  for (const [questionId, rawAnswer] of Object.entries(answers as Record<string, unknown>)) {
    const normalizedQuestionId = String(questionId).replace(/[^0-9]/g, '');
    if (!normalizedQuestionId) continue;

    const normalizedAnswer = String(rawAnswer || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();

    if (normalizedAnswer) {
      result[normalizedQuestionId] = normalizedAnswer;
    }
  }

  return result;
};

const normalizeEssayResults = (
  essayResults: unknown,
  essayQuestionMaxScore: Map<number, number>
): EssayGradingResult[] => {
  if (!Array.isArray(essayResults)) return [];

  const normalizedByQuestion = new Map<number, EssayGradingResult>();

  for (const item of essayResults) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as {
      questionId?: unknown;
      score?: unknown;
      maxScore?: unknown;
      feedback?: unknown;
    };

    const questionId = Number.parseInt(String(raw.questionId), 10);
    if (!Number.isFinite(questionId) || !essayQuestionMaxScore.has(questionId)) continue;

    const configuredMaxScore = essayQuestionMaxScore.get(questionId) || 1;
    const incomingMaxScore = Number(raw.maxScore);
    const resolvedMaxScore =
      Number.isFinite(incomingMaxScore) && incomingMaxScore > 0
        ? Math.min(incomingMaxScore, configuredMaxScore)
        : configuredMaxScore;

    const incomingScore = Number(raw.score);
    const resolvedScore = Number.isFinite(incomingScore)
      ? Math.max(0, Math.min(resolvedMaxScore, incomingScore))
      : 0;

    normalizedByQuestion.set(questionId, {
      questionId,
      score: Number(resolvedScore.toFixed(2)),
      maxScore: Number(resolvedMaxScore.toFixed(2)),
      feedback: String(raw.feedback || '').trim().slice(0, 1000),
    });
  }

  return Array.from(normalizedByQuestion.values()).sort((a, b) => a.questionId - b.questionId);
};

export const getGeminiErrorStatusCode = (error: unknown): number | null => {
  return parseStatusCode(error);
};

export const extractAndGradeSubmissionFromScansBatch = async (
  input: SubmissionBatchExtractionInput
): Promise<SubmissionBatchExtractionResult> => {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  if (!Array.isArray(input.scanPaths) || input.scanPaths.length === 0) {
    throw new Error('At least one scan image is required for multimodal grading');
  }

  for (const scanPath of input.scanPaths) {
    if (!fs.existsSync(scanPath)) {
      throw new Error(`Scan file not found: ${scanPath}`);
    }
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const cleanupHandlers: Array<() => void> = [];
  const preprocessedWarnings: string[] = [];
  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

  try {
    for (let index = 0; index < input.scanPaths.length; index += 1) {
      const preprocessed = await preprocessScanForAnalysis(input.scanPaths[index]);
      cleanupHandlers.push(preprocessed.cleanup);

      if (preprocessed.warnings.length > 0) {
        preprocessedWarnings.push(...preprocessed.warnings.map((warning) => `[Trang ${index + 1}] ${warning}`));
      }

      const ext = path.extname(preprocessed.processedPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const imageBase64 = fs.readFileSync(preprocessed.processedPath).toString('base64');

      imageParts.push({
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      });
    }

    const prompt = `Bạn là AI chấm bài thi từ nhiều ảnh của cùng MỘT sinh viên.

Mục tiêu:
1. Nhận diện họ tên và MSSV từ TRANG 1 (ảnh đầu tiên).
2. Trích xuất câu trả lời tự luận và chấm điểm tự luận theo đáp án/rubric cho từng câu.

Ngữ cảnh bài thi:
${JSON.stringify(
      {
        scannablePages: input.scannablePages,
        passPurposeByIndex: input.passPurposeByIndex || {},
        layoutBlueprint: input.layoutBlueprint || {},
        essayQuestions: input.essayQuestions,
      },
      null,
      2
    )}

Ràng buộc bắt buộc:
1. Trả về DUY NHẤT JSON hợp lệ, không markdown, không giải thích.
2. Không bịa dữ liệu. Nếu không đọc được họ tên hoặc MSSV thì trả null.
3. score của essayResults phải trong khoảng [0, maxScore] từng câu.
4. Nếu ảnh mờ, lệch, thiếu góc hoặc khó đọc thì ghi rõ trong warnings.

Output JSON format:
{
  "fullName": "... hoặc null",
  "studentCode": "... hoặc null",
  "essayAnswers": { "34": "..." },
  "essayResults": [
    {
      "questionId": 34,
      "score": 0.75,
      "maxScore": 1,
      "feedback": "..."
    }
  ],
  "warnings": ["..."]
}`;

    const rawText = await generateGeminiText(model, [...imageParts, prompt]);
    const parsed = parseModelJson<{
      fullName?: string | null;
      studentCode?: string | null;
      essayAnswers?: Record<string, unknown>;
      essayResults?: unknown;
      warnings?: unknown;
    }>(rawText);

    const modelWarnings = Array.isArray(parsed?.warnings)
      ? parsed.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    const essayQuestionMaxScore = new Map<number, number>(
      input.essayQuestions.map((question) => [question.questionId, Math.max(0, Number(question.maxScore) || 0)])
    );

    return {
      fullName: parsed?.fullName ? String(parsed.fullName).trim() : null,
      studentCode: parsed?.studentCode ? String(parsed.studentCode).trim() : null,
      essayAnswers: normalizeEssayAnswers(parsed?.essayAnswers),
      essayResults: normalizeEssayResults(parsed?.essayResults, essayQuestionMaxScore),
      warnings: [...new Set([...preprocessedWarnings, ...modelWarnings])],
    };
  } finally {
    for (const cleanup of cleanupHandlers) {
      cleanup();
    }
  }
};

/**
 * Determines how many students to group in one Gemini request based on essay count.
 * Target: 8-10 images per request.
 * e.g. 4 essays → each student has ~4 pages → batch 2 students (8 images)
 *      3 essays → each student has ~3 pages → batch 3 students (9 images)
 *      5 essays → each student has ~5 pages → batch 2 students (10 images)
 *      2 essays → each student has ~2 pages → batch 4 students (8 images)
 */
export const computeMultiStudentBatchSize = (essayQuestionCount: number, pagesPerStudent: number): number => {
  if (pagesPerStudent <= 0) return 1;
  // Target between 8-10 total images per request
  const targetImages = 10;
  const batchSize = Math.max(1, Math.floor(targetImages / pagesPerStudent));
  // Cap at 5 students per batch to keep prompt manageable
  return Math.min(batchSize, 5);
};

export interface MultiStudentBatchInput {
  studentLabel: string; // e.g. "Student 1" or student ID for correlation
  scanPaths: string[];
}

export interface MultiStudentBatchResult {
  studentLabel: string;
  fullName: string | null;
  studentCode: string | null;
  essayAnswers: Record<string, string>;
  essayResults: EssayGradingResult[];
  warnings: string[];
}

export const extractAndGradeMultiStudentBatch = async (
  students: MultiStudentBatchInput[],
  essayQuestions: SubmissionBatchEssayQuestion[],
  scannablePages: number,
  passPurposeByIndex?: Record<string, string>,
  layoutBlueprint?: ScanLayoutBlueprint,
): Promise<MultiStudentBatchResult[]> => {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  if (students.length === 0) {
    return [];
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const cleanupHandlers: Array<() => void> = [];
  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  const preprocessedWarnings: string[] = [];

  // Build image manifest describing which images belong to which student
  const imageManifest: Array<{ studentLabel: string; imageIndex: number; pageOfStudent: number }> = [];
  let globalImageIndex = 0;

  try {
    for (const student of students) {
      for (let pageIdx = 0; pageIdx < student.scanPaths.length; pageIdx++) {
        const scanPath = student.scanPaths[pageIdx];
        if (!fs.existsSync(scanPath)) {
          throw new Error(`Scan file not found: ${scanPath}`);
        }

        const preprocessed = await preprocessScanForAnalysis(scanPath);
        cleanupHandlers.push(preprocessed.cleanup);

        if (preprocessed.warnings.length > 0) {
          preprocessedWarnings.push(
            ...preprocessed.warnings.map((w) => `[${student.studentLabel} - Page ${pageIdx + 1}] ${w}`)
          );
        }

        const ext = path.extname(preprocessed.processedPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const imageBase64 = fs.readFileSync(preprocessed.processedPath).toString('base64');

        imageParts.push({ inlineData: { mimeType, data: imageBase64 } });
        imageManifest.push({
          studentLabel: student.studentLabel,
          imageIndex: globalImageIndex,
          pageOfStudent: pageIdx + 1,
        });
        globalImageIndex++;
      }
    }

    const studentLabels = students.map((s) => s.studentLabel);

    const prompt = `Bạn là AI chấm bài thi từ ảnh quét của NHIỀU sinh viên cùng lúc.

Tổng số ảnh: ${imageParts.length}
Số sinh viên: ${students.length}
Mỗi sinh viên có ${scannablePages} trang.

Phân bổ ảnh theo sinh viên:
${imageManifest.map((m) => `  Ảnh ${m.imageIndex + 1}: ${m.studentLabel} - Trang ${m.pageOfStudent}`).join('\n')}

Mục tiêu cho MỖI sinh viên:
1. Nhận diện họ tên và MSSV từ trang đầu tiên của sinh viên đó.
2. Trích xuất câu trả lời tự luận và chấm điểm theo rubric.

Thông tin bài thi:
${JSON.stringify(
      {
        scannablePages,
        passPurposeByIndex: passPurposeByIndex || {},
        layoutBlueprint: layoutBlueprint || {},
        essayQuestions,
      },
      null,
      2
    )}

Ràng buộc bắt buộc:
1. Trả về DUY NHẤT JSON hợp lệ, không markdown, không giải thích.
2. Không bịa dữ liệu. Nếu không đọc được thì trả null.
3. score phải trong khoảng [0, maxScore] cho mỗi câu.
4. Nếu ảnh mờ hoặc khó đọc, ghi vào warnings.

Output JSON format (mảng kết quả cho từng sinh viên):
{
  "students": [
    {
      "studentLabel": "${studentLabels[0]}",
      "fullName": "... hoặc null",
      "studentCode": "... hoặc null",
      "essayAnswers": { "34": "..." },
      "essayResults": [
        {
          "questionId": 34,
          "score": 0.75,
          "maxScore": 1,
          "feedback": "..."
        }
      ],
      "warnings": ["..."]
    }
  ]
}`;

    const rawText = await generateGeminiText(model, [...imageParts, prompt]);
    const parsed = parseModelJson<{
      students?: Array<{
        studentLabel?: string;
        fullName?: string | null;
        studentCode?: string | null;
        essayAnswers?: Record<string, unknown>;
        essayResults?: unknown;
        warnings?: unknown;
      }>;
    }>(rawText);

    const essayQuestionMaxScore = new Map<number, number>(
      essayQuestions.map((q) => [q.questionId, Math.max(0, Number(q.maxScore) || 0)])
    );

    const resultsArray = Array.isArray(parsed?.students) ? parsed.students : [];

    // Map results back to students by label or index
    return students.map((student, idx) => {
      const match = resultsArray.find((r) => r.studentLabel === student.studentLabel) || resultsArray[idx];

      if (!match) {
        return {
          studentLabel: student.studentLabel,
          fullName: null,
          studentCode: null,
          essayAnswers: {},
          essayResults: [],
          warnings: [...preprocessedWarnings.filter((w) => w.includes(student.studentLabel)), 'No AI result returned for this student'],
        };
      }

      const modelWarnings = Array.isArray(match.warnings)
        ? match.warnings.map((w) => String(w || '').trim()).filter(Boolean)
        : [];

      return {
        studentLabel: student.studentLabel,
        fullName: match.fullName ? String(match.fullName).trim() : null,
        studentCode: match.studentCode ? String(match.studentCode).trim() : null,
        essayAnswers: normalizeEssayAnswers(match.essayAnswers),
        essayResults: normalizeEssayResults(match.essayResults, essayQuestionMaxScore),
        warnings: [...new Set([
          ...preprocessedWarnings.filter((w) => w.includes(student.studentLabel)),
          ...modelWarnings,
        ])],
      };
    });
  } finally {
    for (const cleanup of cleanupHandlers) {
      cleanup();
    }
  }
};
