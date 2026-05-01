import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

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
      rubric,
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

    const subject = await prisma.subject.findUnique({ where: { id: parseInt(subjectId) } });
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
        subjectId: parseInt(subjectId),
        type,
        content,
        answer,
        options: options ? JSON.stringify(options) : null,
        status: status || 'ACTIVE',
        difficulty: normalizeDifficulty(difficulty),
        learningOutcomeId: learningOutcomeId ? parseInt(String(learningOutcomeId), 10) : null,
        rubric: rubric || null,
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

    const { type, content, answer, options, status, difficulty, learningOutcomeId, rubric } = req.body;
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
        rubric: rubric ?? question.rubric,
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

export const importQuestionsFromExcel = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });

    if (rows.length === 0) {
      res.status(400).json({ error: 'Excel file has no data rows' });
      return;
    }

    const outcomes = await prisma.learningOutcome.findMany({ where: { subjectId } });
    const outcomeMap = new Map(outcomes.map((item) => [item.code.toUpperCase(), item.id]));

    let inserted = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      const content = String(row.content || row.question || '').trim();
      const answer = String(row.answer || '').trim();
      const type = normalizeQuestionType(String(row.type || row.questionType || ''));
      const outcomeCode = String(row.learningOutcomeCode || row.outcomeCode || '').trim().toUpperCase();
      const difficulty = normalizeDifficulty(row.difficulty || 'MEDIUM');
      const rubric = String(row.rubric || '').trim();

      if (!content || !answer || !type) {
        errors.push({ row: rowNumber, message: 'Missing required fields: content, answer, or type' });
        continue;
      }

      const optionsRaw = String(row.options || '').trim();
      const options = optionsRaw
        ? optionsRaw.split('|').map((item) => item.trim()).filter(Boolean)
        : [];

      if (type === 'MULTIPLE_CHOICE' && options.length !== 4) {
        errors.push({ row: rowNumber, message: 'Multiple choice question must have exactly 4 options separated by |' });
        continue;
      }

      let learningOutcomeId: number | null = null;
      if (outcomeCode) {
        learningOutcomeId = outcomeMap.get(outcomeCode) || null;
        if (!learningOutcomeId) {
          errors.push({ row: rowNumber, message: `Outcome code not found: ${outcomeCode}` });
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

      await prisma.question.create({
        data: {
          subjectId,
          type,
          content,
          answer,
          options: type === 'MULTIPLE_CHOICE' ? JSON.stringify(options) : null,
          difficulty,
          rubric: type === 'ESSAY' ? rubric || null : null,
          learningOutcomeId,
          status: 'ACTIVE',
        },
      });
      inserted += 1;
    }

    res.json({
      message: 'Excel import completed',
      totalRows: rows.length,
      inserted,
      skipped: rows.length - inserted - errors.length,
      errors,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import questions from Excel' });
  }
};
