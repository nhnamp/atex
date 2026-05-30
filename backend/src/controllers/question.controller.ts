import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();
const EXCEL_MAX_ROWS = 500;

const normalizeQuestionType = (raw: string): 'MULTIPLE_CHOICE' | 'ESSAY' | null => {
  const value = String(raw || '').trim().toUpperCase();
  if (['MULTIPLE_CHOICE', 'MC', 'TRAC_NGHIEM', 'TRACNGHIEM'].includes(value)) return 'MULTIPLE_CHOICE';
  if (['ESSAY', 'TL', 'TU_LUAN', 'TULUAN'].includes(value)) return 'ESSAY';
  return null;
};

const normalizeDifficulty = (raw: unknown): 'EASY' | 'MEDIUM' | 'HARD' => {
  const value = String(raw || '').trim().toUpperCase();
  if (['EASY', '1', '2'].includes(value)) return 'EASY';
  if (['MEDIUM', '3', '4'].includes(value)) return 'MEDIUM';
  if (['HARD', '5'].includes(value)) return 'HARD';
  return 'MEDIUM';
};

export const getQuestionsBySubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const search = String(req.query.search || '').trim();
    const type = String(req.query.type || '').trim();
    const status = String(req.query.status || '').trim();
    const difficulty = String(req.query.difficulty || '').trim();
    const learningOutcomeId = String(req.query.learningOutcomeId || '').trim();
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });

    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const questions = await prisma.question.findMany({
      where: {
        subjectId,
        ...(type && type !== 'ALL' ? { type } : {}),
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(difficulty ? { difficulty: normalizeDifficulty(difficulty) } : {}),
        ...(learningOutcomeId ? { learningOutcomeId: parseInt(learningOutcomeId, 10) } : {}),
        ...(search
          ? {
              OR: [
                { content: { contains: search } },
                { answer: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        learningOutcome: {
          select: { id: true, code: true, description: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(questions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      subjectId,
      type,
      content,
      answer,
      options,
      status,
      difficulty,
      learningOutcomeId,
    } = req.body;

    if (!subjectId || !type || !content || !answer) {
      res.status(400).json({ error: 'subjectId, type, content, and answer are required' });
      return;
    }

    const validTypes = ['MULTIPLE_CHOICE', 'ESSAY'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    if (type === 'MULTIPLE_CHOICE' && (!options || !Array.isArray(options) || options.length !== 4)) {
      res.status(400).json({ error: 'Multiple choice questions require exactly 4 options' });
      return;
    }

    const question = await prisma.question.create({
      data: {
        subjectId,
        type,
        content,
        answer,
        options: options ? JSON.stringify(options) : null,
        status: status || 'ACTIVE',
        difficulty: normalizeDifficulty(difficulty),
        learningOutcomeId: learningOutcomeId ? parseInt(String(learningOutcomeId), 10) : null,
      },
    });

    res.status(201).json(question);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const question = await prisma.question.findUnique({
      where: { id },
      include: { subject: true },
    });

    if (!question || question.subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const { type, content, answer, options, status, difficulty, learningOutcomeId } = req.body;
    const updated = await prisma.question.update({
      where: { id },
      data: {
        type: type ?? question.type,
        content: content ?? question.content,
        answer: answer ?? question.answer,
        options: options ? JSON.stringify(options) : question.options,
        status: status ?? question.status,
        difficulty: difficulty ? normalizeDifficulty(difficulty) : question.difficulty,
        learningOutcomeId:
          learningOutcomeId === null
            ? null
            : Number.isFinite(Number(learningOutcomeId))
              ? parseInt(String(learningOutcomeId), 10)
              : question.learningOutcomeId,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteQuestion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const question = await prisma.question.findUnique({
      where: { id },
      include: { subject: true },
    });

    if (!question || question.subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    await prisma.question.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    res.json({ message: 'Question archived' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

interface ParsedQuestion {
  id: string;
  type: 'MULTIPLE_CHOICE' | 'ESSAY';
  content: string;
  answer: string;
  options?: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  learningOutcomeCode?: string;
}

export const previewQuestionsFromExcel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;

    if (!file) {
      res.status(400).json({ error: 'Excel file is required' });
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    
    if (workbook.SheetNames.length === 0) {
      res.status(400).json({ error: 'Excel file has no sheets' });
      return;
    }

    const allRows: Record<string, unknown>[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      allRows.push(...rows);
    }

    if (allRows.length === 0) {
      res.status(400).json({ error: 'Excel file has no data rows' });
      return;
    }

    if (allRows.length > EXCEL_MAX_ROWS) {
      res.status(400).json({ error: `Excel file exceeds maximum of ${EXCEL_MAX_ROWS} rows (found ${allRows.length})` });
      return;
    }

    const outcomes = await prisma.learningOutcome.findMany({ where: { subjectId } });
    const outcomeMap = new Map(outcomes.map((item) => [item.code.toUpperCase(), item.id]));

    const questions: ParsedQuestion[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const rowNumber = i + 2;

      const content = String(row['Question Content'] || row.content || row.question || '').trim();
      const answer = String(row['Correct Answer'] || row.answer || '').trim();
      const typeRaw = String(row['Question Type'] || row.type || row.questionType || '').trim();
      const type = normalizeQuestionType(typeRaw);
      const outcomeCode = String(row['Learning Outcome Code'] || row.learningOutcomeCode || row.outcomeCode || '').trim().toUpperCase();
      const difficulty = normalizeDifficulty(row.Difficulty || row.difficulty || 'MEDIUM');

      if (!content || !answer || !type) {
        errors.push({ row: rowNumber, message: 'Missing required fields: Question Content, Correct Answer, or Question Type' });
        continue;
      }

      const optionsRaw = String(row['Options (A|B|C|D)'] || row.options || '').trim();
      const options = optionsRaw
        ? optionsRaw.split('|').map((item) => item.trim()).filter(Boolean)
        : [];

      if (type === 'MULTIPLE_CHOICE' && options.length !== 4) {
        errors.push({ row: rowNumber, message: 'Multiple choice question must have exactly 4 options separated by | (found ' + options.length + ')' });
        continue;
      }

      let learningOutcomeId: number | null = null;
      if (outcomeCode) {
        learningOutcomeId = outcomeMap.get(outcomeCode) || null;
        if (!learningOutcomeId) {
          errors.push({ row: rowNumber, message: `Learning Outcome code not found in database: ${outcomeCode}` });
          continue;
        }
      }

      const question: ParsedQuestion = {
        id: `temp-${i}`,
        type,
        content,
        answer,
        difficulty,
      };

      if (type === 'MULTIPLE_CHOICE') {
        question.options = options;
      }

      if (outcomeCode) {
        question.learningOutcomeCode = outcomeCode;
      }

      questions.push(question);
    }

    res.json({
      successCount: questions.length,
      errorCount: errors.length,
      questions,
      errors,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to preview Excel file' });
  }
};

export const downloadTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templatePath = path.join(__dirname, '../../..', 'template', 'question-import-template.xlsx');
    
    if (!fs.existsSync(templatePath)) {
      res.status(404).json({ error: 'Template file not found' });
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="question-import-template.xlsx"');
    
    const fileStream = fs.createReadStream(templatePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to download template' });
  }
};

export const importQuestionsFromExcel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const { questions: questionsData } = req.body;

    if (!questionsData || !Array.isArray(questionsData) || questionsData.length === 0) {
      res.status(400).json({ error: 'Questions array is required' });
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const outcomes = await prisma.learningOutcome.findMany({ where: { subjectId } });
    const outcomeMap = new Map(outcomes.map((item) => [item.code.toUpperCase(), item.id]));

    let inserted = 0;
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < questionsData.length; i++) {
      const qData = questionsData[i];

      try {
        const content = String(qData.content || '').trim();
        const answer = String(qData.answer || '').trim();
        const type = qData.type as 'MULTIPLE_CHOICE' | 'ESSAY' | undefined;
        const difficulty = (qData.difficulty || 'MEDIUM') as 'EASY' | 'MEDIUM' | 'HARD';
        const learningOutcomeCode = String(qData.learningOutcomeCode || '').trim().toUpperCase();

        if (!content || !answer || !type || !['MULTIPLE_CHOICE', 'ESSAY'].includes(type)) {
          errors.push({ index: i, message: 'Invalid question data' });
          continue;
        }

        let learningOutcomeId: number | null = null;
        if (learningOutcomeCode) {
          learningOutcomeId = outcomeMap.get(learningOutcomeCode) || null;
          if (!learningOutcomeId) {
            errors.push({ index: i, message: `Learning Outcome code not found: ${learningOutcomeCode}` });
            continue;
          }
        }

        const existing = await prisma.question.findFirst({
          where: {
            subjectId,
            type,
            content,
            answer,
          },
        });

        if (existing) {
          continue;
        }

        const options = type === 'MULTIPLE_CHOICE' ? qData.options : undefined;

        await prisma.question.create({
          data: {
            subjectId,
            type,
            content,
            answer,
            options: options ? JSON.stringify(options) : null,
            difficulty,
            learningOutcomeId,
            status: 'ACTIVE',
          },
        });
        inserted += 1;
      } catch (err) {
        console.error(err);
        errors.push({ index: i, message: 'Error processing question' });
      }
    }

    res.json({
      message: `Successfully imported ${inserted} question(s)`,
      imported: inserted,
      failed: errors.length,
      errors,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import questions' });
  }
};
