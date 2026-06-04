import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import fs from 'fs';
import path from 'path';


const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const GEMINI_MIN_CALL_INTERVAL_MS = 15_000;

// Models to try in priority order. When a model is rate-limited (429) or
// overloaded (503), it is put on cooldown and the next model is used instead.
const GEMINI_MODEL_CHAIN = config.geminiModels;
const GEMINI_MODEL_COOLDOWN_MS = config.geminiModelCooldownMs;

let geminiQueue: Promise<void> = Promise.resolve();
let lastGeminiCallStartedAt = 0;

// modelId -> epoch ms until which the model is skipped after a 429/503.
const modelCooldownUntil = new Map<string, number>();
const modelInstanceCache = new Map<string, any>();

const getGeminiModel = (modelId: string): any => {
  let model = modelInstanceCache.get(modelId);
  if (!model) {
    model = genAI.getGenerativeModel({ model: modelId });
    modelInstanceCache.set(modelId, model);
  }
  return model;
};

const isModelCoolingDown = (modelId: string): boolean => {
  const until = modelCooldownUntil.get(modelId);
  return typeof until === 'number' && until > Date.now();
};

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

const enqueueGeminiRequest = async <T>(operation: () => Promise<T>): Promise<T> => {
  const execute = async (): Promise<T> => {
    const elapsed = Date.now() - lastGeminiCallStartedAt;
    const waitMs = Math.max(0, GEMINI_MIN_CALL_INTERVAL_MS - elapsed);
    await sleep(waitMs);

    lastGeminiCallStartedAt = Date.now();
    return operation();
  };

  const task = geminiQueue.then(execute, execute);
  geminiQueue = task.then(
    () => undefined,
    () => undefined
  );

  return task;
};

/**
 * Generates text by walking the configured model chain in priority order.
 * On a 429 (out of quota / rate limit) or 503 (overloaded), the current model
 * is put on cooldown and the next model is tried. A model that returns a
 * non-retryable error fails the whole request immediately. On success a model's
 * cooldown is cleared so it is preferred again straight away.
 */
const generateGeminiText = async (payload: unknown): Promise<string> => {
  return enqueueGeminiRequest<string>(async () => {
    const available = GEMINI_MODEL_CHAIN.filter((modelId) => !isModelCoolingDown(modelId));
    // If every model is cooling down, fall back to trying the whole chain anyway.
    const order = available.length > 0 ? available : GEMINI_MODEL_CHAIN;

    let lastError: unknown;
    for (const modelId of order) {
      try {
        const model = getGeminiModel(modelId);
        const result: any = await model.generateContent(payload as any);
        modelCooldownUntil.delete(modelId);
        return String(result.response.text() || '').trim();
      } catch (error) {
        lastError = error;
        if (isRetryableGeminiError(error)) {
          modelCooldownUntil.set(modelId, Date.now() + GEMINI_MODEL_COOLDOWN_MS);
          console.warn(
            `[gemini] model "${modelId}" unavailable (status ${parseStatusCode(error) ?? '?'}); cooling down ${GEMINI_MODEL_COOLDOWN_MS}ms and falling back to next model`
          );
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new Error('All Gemini models in the fallback chain are unavailable');
  });
};

export interface EssayGradingResult {
  questionId: number;
  score: number;
  maxScore: number;
  feedback: string;
  componentScores: EssayRubricComponentScore[];
  achievedCriteria: string[];
  missingCriteria: string[];
}

export interface EssayRubricComponentScore {
  criterionId: string;
  description: string;
  score: number;
  maxScore: number;
  achieved: boolean;
  matchedKeywords: string[];
  missingKeywords: string[];
  comments: string;
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

// Hướng dẫn để Gemini TỰ tách đáp án mẫu (sourceAnswerFromDatabase) thành rubric.
// Đáp án mẫu trong DB được chia thành các ý ngăn cách bằng dòng trống, mỗi ý kết
// thúc bằng đánh dấu phần trăm dạng "(30%)" là trọng số điểm của ý đó.
const DEFAULT_ESSAY_RUBRIC = [
  'Tự xây dựng rubric cho từng câu từ sourceAnswerFromDatabase: tách đáp án mẫu thành các tiêu chí (criteria), mỗi ý chính là một tiêu chí.',
  'Các ý trong đáp án mẫu thường được ngăn cách bằng dòng trống; mỗi ý có thể kết thúc bằng đánh dấu phần trăm dạng "(30%)" hoặc "(25%)".',
  'Đánh dấu "(X%)" là TRỌNG SỐ điểm của ý đó: maxScore của tiêu chí = maxScore của câu * X / 100, làm tròn 2 chữ số. Tổng maxScore các tiêu chí phải bằng maxScore của câu.',
  'Nếu một ý không có đánh dấu phần trăm, chia đều phần điểm còn lại cho các ý chưa có trọng số.',
  'KHÔNG coi chuỗi "(X%)" là nội dung đáp án; đó chỉ là metadata trọng số, không đưa vào phần mô tả tiêu chí.',
  'Chỉ cho điểm một tiêu chí khi câu trả lời của thí sinh có cùng ý nghĩa kỹ thuật; chấp nhận diễn đạt khác nhưng không chấp nhận câu chung chung, lạc đề.',
  'Nếu câu trả lời không đề cập một tiêu chí, điểm tiêu chí đó phải bằng 0.',
].join('\n');

const buildEssayQuestionPromptPayload = (essayQuestions: SubmissionBatchEssayQuestion[]) => {
  return essayQuestions.map((question) => ({
    questionId: question.questionId,
    questionContent: question.questionContent,
    maxScore: question.maxScore,
    sourceAnswerFromDatabase: question.expectedAnswer,
    rubricInstructions: DEFAULT_ESSAY_RUBRIC,
  }));
};

const parseModelJson = <T>(rawText: string): T => {
  const cleaned = rawText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  return JSON.parse(cleaned) as T;
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

const normalizeTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
};

const normalizeComponentScores = (value: unknown, questionMaxScore: number): EssayRubricComponentScore[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as {
        criterionId?: unknown;
        description?: unknown;
        mandatoryKeyPoint?: unknown;
        score?: unknown;
        maxScore?: unknown;
        achieved?: unknown;
        matchedKeywords?: unknown;
        missingKeywords?: unknown;
        comments?: unknown;
      };
      const maxScore = Math.max(0, Math.min(questionMaxScore, Number(raw.maxScore) || 0));
      const score = Math.max(0, Math.min(maxScore, Number(raw.score) || 0));
      const description = String(raw.description || raw.mandatoryKeyPoint || '').trim();
      if (!description && maxScore <= 0) return null;

      return {
        criterionId: String(raw.criterionId || `C${index + 1}`).trim(),
        description,
        score: Number(score.toFixed(2)),
        maxScore: Number(maxScore.toFixed(2)),
        achieved: Boolean(raw.achieved) || (maxScore > 0 && score >= maxScore * 0.8),
        matchedKeywords: normalizeTextArray(raw.matchedKeywords),
        missingKeywords: normalizeTextArray(raw.missingKeywords),
        comments: String(raw.comments || '').trim().slice(0, 500),
      };
    })
    .filter((item): item is EssayRubricComponentScore => Boolean(item));
};

const normalizeEssayResults = (
  essayResults: unknown,
  essayQuestionMaxScore: Map<number, number>,
  essayAnswersByQuestion: Record<string, string> = {}
): EssayGradingResult[] => {
  if (!Array.isArray(essayResults)) return [];

  const normalizedByQuestion = new Map<number, EssayGradingResult>();

  for (const item of essayResults) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as {
      questionId?: unknown;
      score?: unknown;
      totalScore?: unknown;
      maxScore?: unknown;
      feedback?: unknown;
      comments?: unknown;
      componentScores?: unknown;
      achievedCriteria?: unknown;
      missingCriteria?: unknown;
    };

    const questionId = Number.parseInt(String(raw.questionId), 10);
    if (!Number.isFinite(questionId) || !essayQuestionMaxScore.has(questionId)) continue;

    const configuredMaxScore = essayQuestionMaxScore.get(questionId) || 1;
    const incomingMaxScore = Number(raw.maxScore);
    const resolvedMaxScore =
      Number.isFinite(incomingMaxScore) && incomingMaxScore > 0
        ? Math.min(incomingMaxScore, configuredMaxScore)
        : configuredMaxScore;

    const extractedAnswer = String(essayAnswersByQuestion[String(questionId)] || '').trim();
    const answerWordCount = extractedAnswer.split(/\s+/).filter(Boolean).length;
    const incomingScore = Number(raw.totalScore ?? raw.score);
    const resolvedScore = Number.isFinite(incomingScore)
      ? Math.max(0, Math.min(resolvedMaxScore, incomingScore))
      : 0;
    const componentScores = normalizeComponentScores(raw.componentScores, resolvedMaxScore);
    const componentTotal = componentScores.length > 0
      ? componentScores.reduce((acc, component) => acc + component.score, 0)
      : resolvedScore;
    const feedbackText = String(raw.feedback || '').toLowerCase();
    const strongNegativeFeedback = /(sai|lạc đề|không đúng|không nêu|không trả lời|chưa giải thích|chưa đưa ra|né tránh|mơ hồ|không có bằng chứng)/i.test(feedbackText);
    const partialNegativeFeedback = /(thiếu|chưa đầy đủ|chung chung|một phần|sơ sài)/i.test(feedbackText);
    const cappedByAnswerLength = !extractedAnswer
      ? 0
      : answerWordCount < 6
        ? Math.min(resolvedScore, componentTotal, resolvedMaxScore * 0.2)
        : Math.min(resolvedScore, componentTotal);
    const cappedByFeedback = strongNegativeFeedback
      ? Math.min(cappedByAnswerLength, resolvedMaxScore * 0.2)
      : partialNegativeFeedback
        ? Math.min(cappedByAnswerLength, resolvedMaxScore * 0.6)
        : cappedByAnswerLength;

    normalizedByQuestion.set(questionId, {
      questionId,
      score: Number(cappedByFeedback.toFixed(2)),
      maxScore: Number(resolvedMaxScore.toFixed(2)),
      feedback: String(raw.feedback || raw.comments || '').trim().slice(0, 1000),
      componentScores,
      achievedCriteria: normalizeTextArray(raw.achievedCriteria),
      missingCriteria: normalizeTextArray(raw.missingCriteria),
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

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

  try {
    for (let index = 0; index < input.scanPaths.length; index += 1) {
      const ext = path.extname(input.scanPaths[index]).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const imageBase64 = fs.readFileSync(input.scanPaths[index]).toString('base64');

      imageParts.push({
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      });
    }

    const prompt = `Bạn là AI chấm phần TỰ LUẬN của bài thi từ nhiều ảnh của cùng MỘT sinh viên.

Mục tiêu:
1. Chỉ trích xuất câu trả lời tự luận từ các trang tự luận.
2. Với mỗi câu, TỰ tách đáp án mẫu (sourceAnswerFromDatabase) thành các tiêu chí rubric theo hướng dẫn rubricInstructions/defaultRubric, dùng đánh dấu "(X%)" ở cuối mỗi ý làm trọng số điểm.
3. Chấm điểm bằng cách so sánh câu trả lời thí sinh với từng tiêu chí vừa tách.
4. Không nhận diện họ tên, MSSV, khuôn mặt, hoặc danh tính thí sinh.

Ngữ cảnh bài thi:
${JSON.stringify(
      {
        scannablePages: input.scannablePages,
        passPurposeByIndex: input.passPurposeByIndex || {},
        layoutBlueprint: input.layoutBlueprint || {},
        defaultRubric: DEFAULT_ESSAY_RUBRIC,
        essayQuestions: buildEssayQuestionPromptPayload(input.essayQuestions),
      },
      null,
      2
    )}

Ràng buộc bắt buộc:
1. Trả về DUY NHẤT JSON hợp lệ, không markdown, không giải thích.
2. Không bịa dữ liệu. Không sử dụng ảnh để xác định thí sinh.
3. TỰ tách rubric từ sourceAnswerFromDatabase: mỗi ý chính là một tiêu chí trong componentScores, criterionId dạng "Q{questionId}-C{n}".
4. Đánh dấu "(X%)" ở cuối mỗi ý là trọng số điểm của ý đó: maxScore tiêu chí = maxScore câu * X / 100 (làm tròn 2 chữ số); tổng maxScore các tiêu chí phải bằng maxScore của câu. Nếu một ý không có "(X%)", chia đều phần điểm còn lại. KHÔNG đưa chuỗi "(X%)" vào phần mô tả tiêu chí.
5. Với MỖI tiêu chí, phải ghi rõ đạt hay thiếu trong componentScores (achieved, matchedKeywords, missingKeywords).
6. Chỉ cho điểm của một tiêu chí khi câu trả lời có cùng ý nghĩa kỹ thuật; chấp nhận diễn đạt khác nhưng không chấp nhận câu chung chung.
7. Nếu câu trả lời sai, lạc đề, né tránh, chỉ lặp lại đề, quá chung chung, hoặc không có bằng chứng trong ảnh thì totalScore/score phải là 0 hoặc tối đa 20% maxScore.
8. totalScore/score của essayResults phải bằng tổng score trong componentScores và nằm trong [0, maxScore] từng câu.
9. feedback/comments phải nêu ngắn gọn tiêu chí nào đạt, tiêu chí nào thiếu/sai, và lý do điểm.
10. Nếu ảnh mờ, lệch, thiếu góc hoặc khó đọc thì ghi rõ trong warnings.

Output JSON format:
{
  "fullName": null,
  "studentCode": null,
  "essayAnswers": { "34": "..." },
  "essayResults": [
    {
      "questionId": 34,
      "maxScore": 1,
      "score": 0.75,
      "totalScore": 0.75,
      "componentScores": [
        {
          "criterionId": "Q34-C1",
          "description": "...",
          "score": 0.5,
          "maxScore": 0.5,
          "achieved": true,
          "matchedKeywords": ["..."],
          "missingKeywords": [],
          "comments": "..."
        }
      ],
      "achievedCriteria": ["Q34-C1"],
      "missingCriteria": ["Q34-C2"],
      "feedback": "..."
    }
  ],
  "warnings": ["..."]
}`;

    const rawText = await generateGeminiText([...imageParts, prompt]);
    const parsed = parseModelJson<{
      fullName?: string | null;
      studentCode?: string | null;
      essayAnswers?: Record<string, unknown>;
      essayResults?: unknown;
      warnings?: unknown;
    }>(rawText);

    const modelWarnings = Array.isArray(parsed?.warnings)
      ? parsed.warnings.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];

    const essayQuestionMaxScore = new Map<number, number>(
      input.essayQuestions.map((question) => [question.questionId, Math.max(0, Number(question.maxScore) || 0)])
    );

    return {
      fullName: parsed?.fullName ? String(parsed.fullName).trim() : null,
      studentCode: parsed?.studentCode ? String(parsed.studentCode).trim() : null,
      essayAnswers: normalizeEssayAnswers(parsed?.essayAnswers),
      essayResults: normalizeEssayResults(
        parsed?.essayResults,
        essayQuestionMaxScore,
        normalizeEssayAnswers(parsed?.essayAnswers)
      ),
      warnings: [...new Set(modelWarnings)],
    };
  } finally {
    // No cleanup required for native images
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

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

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

        const ext = path.extname(scanPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const imageBase64 = fs.readFileSync(scanPath).toString('base64');

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

    const prompt = `Bạn là AI chấm phần TỰ LUẬN từ ảnh quét của NHIỀU sinh viên cùng lúc.

Tổng số ảnh: ${imageParts.length}
Số sinh viên: ${students.length}
Mỗi sinh viên có ${scannablePages} trang.

Phân bổ ảnh theo sinh viên:
${imageManifest.map((m) => `  Ảnh ${m.imageIndex + 1}: ${m.studentLabel} - Trang ${m.pageOfStudent}`).join('\n')}

Mục tiêu cho MỖI sinh viên:
1. Chỉ trích xuất câu trả lời tự luận từ các trang tự luận của sinh viên đó.
2. Với mỗi câu, TỰ tách đáp án mẫu (sourceAnswerFromDatabase) thành các tiêu chí rubric theo hướng dẫn rubricInstructions/defaultRubric, dùng đánh dấu "(X%)" ở cuối mỗi ý làm trọng số điểm.
3. Chấm điểm bằng cách so sánh câu trả lời thí sinh với từng tiêu chí vừa tách.
4. Không nhận diện họ tên, MSSV, khuôn mặt, hoặc danh tính thí sinh.

Thông tin bài thi:
${JSON.stringify(
      {
        scannablePages,
        passPurposeByIndex: passPurposeByIndex || {},
        layoutBlueprint: layoutBlueprint || {},
        defaultRubric: DEFAULT_ESSAY_RUBRIC,
        essayQuestions: buildEssayQuestionPromptPayload(essayQuestions),
      },
      null,
      2
    )}

Ràng buộc bắt buộc:
1. Trả về DUY NHẤT JSON hợp lệ, không markdown, không giải thích.
2. Không bịa dữ liệu. Không sử dụng ảnh để xác định thí sinh.
3. TỰ tách rubric từ sourceAnswerFromDatabase: mỗi ý chính là một tiêu chí trong componentScores, criterionId dạng "Q{questionId}-C{n}".
4. Đánh dấu "(X%)" ở cuối mỗi ý là trọng số điểm của ý đó: maxScore tiêu chí = maxScore câu * X / 100 (làm tròn 2 chữ số); tổng maxScore các tiêu chí phải bằng maxScore của câu. Nếu một ý không có "(X%)", chia đều phần điểm còn lại. KHÔNG đưa chuỗi "(X%)" vào phần mô tả tiêu chí.
5. Với MỖI tiêu chí, phải ghi rõ đạt hay thiếu trong componentScores (achieved, matchedKeywords, missingKeywords).
6. Chỉ cho điểm của một tiêu chí khi câu trả lời có cùng ý nghĩa kỹ thuật; chấp nhận diễn đạt khác nhưng không chấp nhận câu chung chung.
7. Nếu câu trả lời sai, lạc đề, né tránh, chỉ lặp lại đề, quá chung chung, hoặc không có bằng chứng trong ảnh thì totalScore/score phải là 0 hoặc tối đa 20% maxScore.
8. totalScore/score phải bằng tổng score trong componentScores và nằm trong [0, maxScore] cho mỗi câu.
9. feedback/comments phải nêu ngắn gọn tiêu chí nào đạt, tiêu chí nào thiếu/sai, và lý do điểm.
10. Nếu ảnh mờ hoặc khó đọc, ghi vào warnings.

Output JSON format (mảng kết quả cho từng sinh viên):
{
  "students": [
    {
      "studentLabel": "${studentLabels[0]}",
      "fullName": null,
      "studentCode": null,
      "essayAnswers": { "34": "..." },
      "essayResults": [
        {
          "questionId": 34,
          "maxScore": 1,
          "score": 0.75,
          "totalScore": 0.75,
          "componentScores": [
            {
              "criterionId": "Q34-C1",
              "description": "...",
              "score": 0.5,
              "maxScore": 0.5,
              "achieved": true,
              "matchedKeywords": ["..."],
              "missingKeywords": [],
              "comments": "..."
            }
          ],
          "achievedCriteria": ["Q34-C1"],
          "missingCriteria": ["Q34-C2"],
          "feedback": "..."
        }
      ],
      "warnings": ["..."]
    }
  ]
}`;

    const rawText = await generateGeminiText([...imageParts, prompt]);
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
      const match = resultsArray.find((r: { studentLabel?: string }) => r.studentLabel === student.studentLabel) || resultsArray[idx];

      if (!match) {
        return {
          studentLabel: student.studentLabel,
          fullName: null,
          studentCode: null,
          essayAnswers: {},
          essayResults: [],
          warnings: ['No AI result returned for this student'],
        };
      }

      const modelWarnings = Array.isArray(match.warnings)
        ? match.warnings.map((w: unknown) => String(w || '').trim()).filter(Boolean)
        : [];

      return {
        studentLabel: student.studentLabel,
        fullName: match.fullName ? String(match.fullName).trim() : null,
        studentCode: match.studentCode ? String(match.studentCode).trim() : null,
        essayAnswers: normalizeEssayAnswers(match.essayAnswers),
        essayResults: normalizeEssayResults(
          match.essayResults,
          essayQuestionMaxScore,
          normalizeEssayAnswers(match.essayAnswers)
        ),
        warnings: [...new Set([
          ...modelWarnings,
        ])],
      };
    });
  } finally {
    // No cleanup required for native images
  }
};
