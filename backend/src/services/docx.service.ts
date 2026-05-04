import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

interface Question {
  id: number;
  type: string;
  content: string;
  answer: string;
  options: string | null;
  learningOutcome?: { code?: string; description?: string } | null;
}

type RenderQuestion = {
  question_id: number;
  index: number;
  title: string;
  question: string;
  content: string;
  score: string;
  essay_score: string;
  outcomes_text: string;
  marker_code: string;
  marker_label: string;
  answer_start_marker: string;
  answer_end_marker: string;
};

type RenderMcq = RenderQuestion & {
  [key: string]: unknown;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  optionsA: string;
  optionsB: string;
  optionsC: string;
  optionsD: string;
};

type RenderEssay = RenderQuestion;

type OmrBubble = {
  x: number;
  y: number;
  width: number;
  height: number;
  option: string;
};

type OmrQuestionRegion = {
  questionId: number;
  bubbles: OmrBubble[];
};

export interface ExamScanBlueprint {
  version: number;
  scannablePages: number;
  hasMcq: boolean;
  passPurposeByIndex: Record<string, string>;
  identityPlaceholders: Array<{
    key: string;
    label: string;
    pageIndex: number;
    region: { x: number; y: number; width: number; height: number };
  }>;
  markerAnchors: Array<{
    questionId: number;
    markerCode: string;
    markerLabel: string;
    answerStartMarker: string;
    answerEndMarker: string;
    passIndex: number;
    pageIndex: number;
    purpose: string;
  }>;
  omrTemplate?: {
    referenceWidth: number;
    referenceHeight: number;
    darknessThreshold: number;
    questions: OmrQuestionRegion[];
  };
}

const ALLOWED_TEMPLATE_FILES = new Set([
  'template-omr-essay-ai-scan.docx',
  'template-full-essay-ai-scan.docx',
  'template-answer-key.docx',
]);

const resolveTemplatePath = (templateFileName: string): string => {
  if (!ALLOWED_TEMPLATE_FILES.has(templateFileName)) {
    throw new Error(`Unsupported template file: ${templateFileName}`);
  }

  const candidates = [
    path.resolve(__dirname, '../../../template', templateFileName),
    path.join(process.cwd(), '..', 'template', templateFileName),
    path.join(process.cwd(), 'template', templateFileName),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Template file not found: ${templateFileName}`);
  }

  return found;
};

const sanitizeMultiline = (value: unknown): string => {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
};

const parseOptions = (rawOptions: string | null): string[] => {
  if (!rawOptions) return [];
  try {
    const parsed = JSON.parse(rawOptions) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeMultiline(item));
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      return [
        sanitizeMultiline(obj.A || obj.a || ''),
        sanitizeMultiline(obj.B || obj.b || ''),
        sanitizeMultiline(obj.C || obj.c || ''),
        sanitizeMultiline(obj.D || obj.d || ''),
      ];
    }

    return [];
  } catch {
    const lines = String(rawOptions)
      .split(/\n|\r\n|\r/)
      .map((line) => line.replace(/^\s*[A-D][\).:\-]?\s*/i, '').trim())
      .filter(Boolean);
    return lines.slice(0, 4);
  }
};

const buildOutcomesText = (question: Question): string => {
  const code = sanitizeMultiline(question.learningOutcome?.code || '');
  const description = sanitizeMultiline(question.learningOutcome?.description || '');

  if (code && description) return `${code} - ${description}`;
  if (code) return code;
  if (description) return description;
  return '';
};

const buildAggregatedOutcomesText = (questions: Question[]): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const question of questions) {
    const text = buildOutcomesText(question);
    if (text && !seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.join('\n');
};

const toRenderableQuestion = (question: Question, index: number, points?: number): RenderQuestion => {
  const resolvedPoints = Number.isFinite(points) && points! > 0 ? points! : 1;
  return {
    question_id: question.id,
    index: index + 1,
    title: `Question ${index + 1}`,
    question: sanitizeMultiline(question.content),
    content: sanitizeMultiline(question.content),
    score: resolvedPoints.toFixed(2),
    essay_score: resolvedPoints.toFixed(2),
    outcomes_text: buildOutcomesText(question),
    marker_code: `${question.type === 'MULTIPLE_CHOICE' ? 'MCQ' : 'ESSAY'}_${question.id}`,
    marker_label: `Mã câu: ${question.type === 'MULTIPLE_CHOICE' ? 'MCQ' : 'ESSAY'}_${question.id}`,
    answer_start_marker: `BẮT ĐẦU TRẢ LỜI CÂU ${question.id}`,
    answer_end_marker: `KẾT THÚC TRẢ LỜI CÂU ${question.id}`,
  };
};

const REFERENCE_WIDTH = 2480;
const REFERENCE_HEIGHT = 3508;

const inferScannablePages = (hasMcq: boolean, essayCount: number): number => {
  return hasMcq ? 1 + essayCount : essayCount;
};

const normalizeScannablePages = (value: unknown, fallback: number): number => {
  const normalized = Number.parseInt(String(value), 10);
  if (Number.isFinite(normalized) && normalized > 0) return normalized;
  return fallback;
};

const buildBasePassPurposeByIndex = (mcqs: Question[], essays: Question[]): Record<string, string> => {
  const hasMcq = mcqs.length > 0;
  const map: Record<string, string> = {};

  if (essays.length === 0) {
    map['1'] = 'IDENTITY_OMR';
    return map;
  }

  if (hasMcq) {
    map['1'] = 'IDENTITY_OMR';
    essays.forEach((essay, index) => {
      map[String(index + 2)] = `ESSAY_${essay.id}`;
    });
    return map;
  }

  essays.forEach((essay, index) => {
    map[String(index + 1)] = `IDENTITY_ESSAY_${essay.id}`;
  });
  return map;
};

const buildDefaultIdentityPlaceholders = () => {
  return [
    {
      key: 'student_order',
      label: 'Số thứ tự',
      pageIndex: 1,
      region: { x: 220, y: 320, width: 420, height: 90 },
    },
    {
      key: 'student_name',
      label: 'Họ tên sinh viên',
      pageIndex: 1,
      region: { x: 700, y: 320, width: 1020, height: 90 },
    },
    {
      key: 'student_id',
      label: 'Mã số sinh viên',
      pageIndex: 1,
      region: { x: 1780, y: 320, width: 480, height: 90 },
    },
  ];
};

const buildDefaultOmrTemplate = (mcqs: Question[]) => {
  if (mcqs.length === 0) return undefined;

  const questions: OmrQuestionRegion[] = mcqs.map((question, index) => {
    const startX = 1460;
    const bubbleSize = 30;
    const optionGap = 54;
    const startY = 970;
    const rowHeight = 42;
    const y = startY + index * rowHeight;

    return {
      questionId: question.id,
      bubbles: ['A', 'B', 'C', 'D'].map((option, optionIndex) => ({
        option,
        x: startX + optionIndex * optionGap,
        y,
        width: bubbleSize,
        height: bubbleSize,
      })),
    };
  });

  return {
    referenceWidth: REFERENCE_WIDTH,
    referenceHeight: REFERENCE_HEIGHT,
    darknessThreshold: 165,
    questions,
  };
};

export const buildExamScanBlueprint = (
  mcqs: Question[],
  essays: Question[],
  overrides?: Partial<ExamScanBlueprint>
): ExamScanBlueprint => {
  const hasMcq = mcqs.length > 0;
  const inferredScannablePages = inferScannablePages(hasMcq, essays.length);
  const scannablePages = inferredScannablePages > 0 ? inferredScannablePages : 1;

  const passPurposeByIndex = {
    ...buildBasePassPurposeByIndex(mcqs, essays),
    ...(overrides?.passPurposeByIndex || {}),
  };

  for (let pageIndex = 1; pageIndex <= scannablePages; pageIndex += 1) {
    const key = String(pageIndex);
    if (!passPurposeByIndex[key]) {
      passPurposeByIndex[key] = `PAGE_${pageIndex}`;
    }
  }

  const markerAnchors = [
    ...mcqs.map((question) => ({
      questionId: question.id,
      markerCode: `MCQ_${question.id}`,
      markerLabel: `Mã câu: MCQ_${question.id}`,
      answerStartMarker: '',
      answerEndMarker: '',
      passIndex: 1,
      pageIndex: 1,
      purpose: passPurposeByIndex['1'] || 'IDENTITY_OMR',
    })),
    ...essays.map((question, index) => {
      const passIndex = hasMcq ? index + 2 : index + 1;
      const purpose = passPurposeByIndex[String(passIndex)]
        || (hasMcq ? `ESSAY_${question.id}` : `IDENTITY_ESSAY_${question.id}`);

      return {
        questionId: question.id,
        markerCode: `ESSAY_${question.id}`,
        markerLabel: `Mã câu: ESSAY_${question.id}`,
        answerStartMarker: `BẮT ĐẦU TRẢ LỜI CÂU ${question.id}`,
        answerEndMarker: `KẾT THÚC TRẢ LỜI CÂU ${question.id}`,
        passIndex,
        pageIndex: passIndex,
        purpose,
      };
    }),
  ];

  return {
    version: 1,
    scannablePages,
    hasMcq,
    passPurposeByIndex,
    identityPlaceholders: overrides?.identityPlaceholders || buildDefaultIdentityPlaceholders(),
    markerAnchors: overrides?.markerAnchors || markerAnchors,
    omrTemplate: overrides?.omrTemplate || buildDefaultOmrTemplate(mcqs),
  };
};

const buildExamCoverBlock = (subject: string, duration: number, examCode: string): Array<Paragraph | Table> => {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'EXAM PAPER', bold: true })],
      spacing: { after: 160 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Subject: ${sanitizeMultiline(subject)}`, bold: true })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Duration: ${duration} minutes` })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Exam Code: ${examCode}` })],
      spacing: { after: 220 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: 'Order No:' })] }),
            new TableCell({ children: [new Paragraph({ text: 'Full Name:' })] }),
            new TableCell({ children: [new Paragraph({ text: 'Student ID:' })] }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: '____________________' })] }),
            new TableCell({ children: [new Paragraph({ text: '______________________________' })] }),
            new TableCell({ children: [new Paragraph({ text: '____________________' })] }),
          ],
        }),
      ],
    }),
    new Paragraph({ text: '', spacing: { after: 120 } }),
  ];
};

const buildOmrTable = (mcqs: Question[]): Table => {
  const header = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ text: 'Question', alignment: AlignmentType.CENTER })],
        verticalAlign: VerticalAlign.CENTER,
      }),
      new TableCell({ children: [new Paragraph({ text: 'A', alignment: AlignmentType.CENTER })] }),
      new TableCell({ children: [new Paragraph({ text: 'B', alignment: AlignmentType.CENTER })] }),
      new TableCell({ children: [new Paragraph({ text: 'C', alignment: AlignmentType.CENTER })] }),
      new TableCell({ children: [new Paragraph({ text: 'D', alignment: AlignmentType.CENTER })] }),
    ],
    tableHeader: true,
  });

  const rows = mcqs.map((mcq, index) => new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ text: `${index + 1}. MCQ_${mcq.id}` })],
        verticalAlign: VerticalAlign.CENTER,
      }),
      new TableCell({ children: [new Paragraph({ text: '○', alignment: AlignmentType.CENTER })] }),
      new TableCell({ children: [new Paragraph({ text: '○', alignment: AlignmentType.CENTER })] }),
      new TableCell({ children: [new Paragraph({ text: '○', alignment: AlignmentType.CENTER })] }),
      new TableCell({ children: [new Paragraph({ text: '○', alignment: AlignmentType.CENTER })] }),
    ],
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    },
  });
};

const buildEssayAnswerLines = (lineCount: number): Paragraph[] => {
  const lines: Paragraph[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    lines.push(new Paragraph({
      children: [new TextRun({ text: '....................................................................................................' })],
      spacing: { after: 100 },
    }));
  }
  return lines;
};

const buildEssayQuestionBlock = (essay: Question, label: string): Paragraph[] => {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: label, bold: true })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Mã câu: ESSAY_${essay.id}`, bold: true })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: sanitizeMultiline(essay.content) })],
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `BẮT ĐẦU TRẢ LỜI CÂU ${essay.id}`, italics: true })],
      spacing: { after: 80 },
    }),
    ...buildEssayAnswerLines(18),
    new Paragraph({
      children: [new TextRun({ text: `KẾT THÚC TRẢ LỜI CÂU ${essay.id}`, italics: true })],
      spacing: { before: 80 },
    }),
  ];
};

const buildLearningOutcomesMappingRows = (mcqs: Question[], essays: Question[]) => {
  const mapping = new Map<string, string[]>();

  const pushLabel = (outcomeText: string, label: string) => {
    const key = outcomeText || 'UNMAPPED';
    const existing = mapping.get(key) || [];
    existing.push(label);
    mapping.set(key, existing);
  };

  mcqs.forEach((question, index) => {
    pushLabel(buildOutcomesText(question), `MCQ ${index + 1}`);
  });

  essays.forEach((question, index) => {
    pushLabel(buildOutcomesText(question), `Essay ${index + 1}`);
  });

  if (mapping.size === 0) {
    mapping.set('UNMAPPED', ['No question mapping available']);
  }

  return Array.from(mapping.entries()).map(([outcome, labels]) => ({
    outcome,
    labels: labels.join(', '),
  }));
};

const buildLearningOutcomePage = (mcqs: Question[], essays: Question[]): Array<Paragraph | Table> => {
  const rows = buildLearningOutcomesMappingRows(mcqs, essays);

  const mappingTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: 'Outcome', alignment: AlignmentType.CENTER })] }),
          new TableCell({ children: [new Paragraph({ text: 'Questions', alignment: AlignmentType.CENTER })] }),
        ],
        tableHeader: true,
      }),
      ...rows.map((row) => new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: row.outcome })] }),
          new TableCell({ children: [new Paragraph({ text: row.labels })] }),
        ],
      })),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    },
  });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Learning Outcomes Mapping' })],
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Teacher reference page only - DO NOT SCAN this page.', bold: true })],
      spacing: { after: 160 },
    }),
    mappingTable,
  ];
};

const buildOutcomeMappingTableText = (mcqs: Question[], essays: Question[]): string => {
  const rows = buildLearningOutcomesMappingRows(mcqs, essays).map((row) => ({
    outcome: sanitizeMultiline(row.outcome || 'UNMAPPED'),
    labels: sanitizeMultiline(row.labels || '-'),
  }));

  const outcomeHeader = 'Outcome';
  const questionsHeader = 'Questions (MCQ & Essay)';
  const outcomeWidth = Math.min(
    60,
    Math.max(outcomeHeader.length, ...rows.map((row) => row.outcome.length))
  );

  const header = `${outcomeHeader.padEnd(outcomeWidth, ' ')} | ${questionsHeader}`;
  const divider = `${'-'.repeat(outcomeWidth)}-|-${'-'.repeat(Math.max(questionsHeader.length, 12))}`;
  const body = rows.map((row) => `${row.outcome.padEnd(outcomeWidth, ' ')} | ${row.labels}`);

  return [header, divider, ...body].join('\n');
};

const mapEssaysForTemplate = (essays: Question[], pointsMap?: Map<number, number>): RenderEssay[] => {
  return essays.map((question, index) => ({
    ...toRenderableQuestion(question, index, pointsMap?.get(question.id)),
    title: `Essay ${index + 1}`,
    question: sanitizeMultiline(question.content),
    content: sanitizeMultiline(question.content),
  }));
};

const mapMcqsForTemplate = (mcqs: Question[], pointsMap?: Map<number, number>): RenderMcq[] => {
  return mcqs.map((question, index) => {
    const options = parseOptions(question.options);
    const optionA = options[0] || '';
    const optionB = options[1] || '';
    const optionC = options[2] || '';
    const optionD = options[3] || '';

    return {
      ...toRenderableQuestion(question, index, pointsMap?.get(question.id)),
      title: `MCQ ${index + 1}`,
      question: sanitizeMultiline(question.content),
      content: sanitizeMultiline(question.content),
      options: {
        A: optionA,
        B: optionB,
        C: optionC,
        D: optionD,
      },
      option_a: optionA,
      option_b: optionB,
      option_c: optionC,
      option_d: optionD,
      optionsA: optionA,
      optionsB: optionB,
      optionsC: optionC,
      optionsD: optionD,
      'options.A': optionA,
      'options.B': optionB,
      'options.C': optionC,
      'options.D': optionD,
    };
  });
};

const generateTemplateExamDocx = (
  subject: string,
  duration: number,
  mcqs: Question[],
  essays: Question[],
  pointsMap?: Map<number, number>
): Buffer => {
  const hasMcq = mcqs.length > 0;
  const examCode = `EX-${Date.now().toString().slice(-8)}`;
  const mappedMcqs = mapMcqsForTemplate(mcqs, pointsMap);
  const mappedEssays = mapEssaysForTemplate(essays, pointsMap);
  const firstEssayQuestions = mappedEssays.slice(0, 1);
  const remainingEssayQuestions = mappedEssays.slice(1);
  const outcomesText = buildOutcomeMappingTableText(mcqs, essays);

  // Compute section totals for template placeholders
  const mcqFullScore = mappedMcqs.reduce((acc, q) => acc + Number(q.score), 0);
  const essayFullScore = mappedEssays.reduce((acc, q) => acc + Number(q.score), 0);

  if (hasMcq) {
    return renderDocxTemplate('template-omr-essay-ai-scan.docx', {
      subject: sanitizeMultiline(subject),
      duration: String(duration),
      exam_code: examCode,
      student_order: '',
      student_name: '',
      student_id: '',
      mcq_fullscore: mcqFullScore.toFixed(2),
      essay_fullscore: essayFullScore.toFixed(2),
      mcqs: mappedMcqs,
      essays: mappedEssays,
      essay_questions: mappedEssays,
      first_essay_questions: firstEssayQuestions,
      remaining_essay_questions: remainingEssayQuestions,
      outcomes_text: outcomesText,
    });
  }

  return renderDocxTemplate('template-full-essay-ai-scan.docx', {
    subject: sanitizeMultiline(subject),
    duration: String(duration),
    exam_code: examCode,
    student_order: '',
    student_name: '',
    student_id: '',
    mcq_fullscore: '0.00',
    essay_fullscore: essayFullScore.toFixed(2),
    mcqs: [],
    essays: mappedEssays,
    essay_questions: mappedEssays,
    first_essay_questions: firstEssayQuestions,
    remaining_essay_questions: remainingEssayQuestions,
    outcomes_text: outcomesText,
  });
};

const generateStructuredExamDocx = async (
  subject: string,
  duration: number,
  mcqs: Question[],
  essays: Question[]
): Promise<Buffer> => {
  const examCode = `EX-${Date.now().toString().slice(-8)}`;
  const hasMcq = mcqs.length > 0;

  const children: Array<Paragraph | Table> = [];

  if (hasMcq) {
    children.push(...buildExamCoverBlock(subject, duration, examCode));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Page 1: Student Information + OMR Sheet' })],
      spacing: { after: 120 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Fill one bubble for each multiple-choice question.' })],
      spacing: { after: 120 },
    }));
    children.push(buildOmrTable(mcqs));

    essays.forEach((essay, index) => {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...buildEssayQuestionBlock(essay, `Essay ${index + 1}`));
    });
  } else {
    children.push(...buildExamCoverBlock(subject, duration, examCode));

    if (essays.length > 0) {
      children.push(...buildEssayQuestionBlock(essays[0], 'Essay 1'));

      for (let index = 1; index < essays.length; index += 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        children.push(...buildEssayQuestionBlock(essays[index], `Essay ${index + 1}`));
      }
    } else {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'No essay questions available in this exam.' })],
      }));
    }
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(...buildLearningOutcomePage(mcqs, essays));

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
};

const renderDocxTemplate = (templateFileName: string, data: Record<string, unknown>): Buffer => {
  const templatePath = resolveTemplatePath(templateFileName);
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });

  try {
    doc.render(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to render template "${templateFileName}": ${message}`);
  }

  return doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
};

export const generateEssayExamDocx = async (
  subject: string,
  duration: number,
  essayQuestions: Question[],
  pointsMap?: Map<number, number>
): Promise<Buffer> => {
  return generateTemplateExamDocx(subject, duration, [], essayQuestions, pointsMap);
};

export const generateMcqEssayExamDocx = async (
  subject: string,
  duration: number,
  mcqs: Question[],
  essays: Question[],
  pointsMap?: Map<number, number>
): Promise<Buffer> => {
  return generateTemplateExamDocx(subject, duration, mcqs, essays, pointsMap);
};

export const generateAnswerKeyDocx = async (
  subject: string,
  duration: number,
  mcqs: Question[],
  essays: Question[],
  pointsMap?: Map<number, number>
): Promise<Buffer> => {
  const examCode = 'ANSWER-KEY';
  const templateFile = 'template-answer-key.docx';

  const mappedMcqs = mcqs.map((question, index) => ({
    index: index + 1,
    correct_answer: (question.answer || '').trim().toUpperCase(),
    score: Number(pointsMap?.get(question.id) ?? 1).toFixed(2),
  }));

  const mappedEssays = essays.map((question, index) => ({
    index: index + 1,
    answer: sanitizeMultiline(question.answer),
    score: Number(pointsMap?.get(question.id) ?? 1).toFixed(2),
  }));

  const mcqFullScore = mappedMcqs.reduce((total, question) => total + Number(question.score), 0).toFixed(2);
  const essayFullScore = mappedEssays.reduce((total, question) => total + Number(question.score), 0).toFixed(2);

  return renderDocxTemplate(templateFile, {
    subject: `${sanitizeMultiline(subject)} — ANSWER KEY`,
    duration: String(duration),
    exam_code: examCode,
    total_count: mappedMcqs.length + mappedEssays.length,
    mcq_count: mcqs.length,
    essay_count: essays.length,
    mcq_fullscore: mcqFullScore,
    essay_fullscore: essayFullScore,
    mcqs: mappedMcqs,
    essays: mappedEssays,
  });
};
