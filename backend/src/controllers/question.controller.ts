import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

export const getQuestionsBySubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId));
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });

    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const questions = await prisma.question.findMany({
      where: { subjectId },
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
    const { subjectId, type, content, answer, options } = req.body;

    if (!subjectId || !type || !content || !answer) {
      res.status(400).json({ error: 'subjectId, type, content, and answer are required' });
      return;
    }

    const validTypes = ['MULTIPLE_CHOICE', 'ESSAY', 'TRUE_FALSE'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    if (type === 'MULTIPLE_CHOICE' && (!options || !Array.isArray(options) || options.length < 2)) {
      res.status(400).json({ error: 'Multiple choice questions require at least 2 options' });
      return;
    }

    const question = await prisma.question.create({
      data: {
        subjectId,
        type,
        content,
        answer,
        options: options ? JSON.stringify(options) : null,
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
    const id = parseInt(String(req.params.id));
    const question = await prisma.question.findUnique({
      where: { id },
      include: { subject: true },
    });

    if (!question || question.subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const { type, content, answer, options } = req.body;
    const updated = await prisma.question.update({
      where: { id },
      data: {
        type: type ?? question.type,
        content: content ?? question.content,
        answer: answer ?? question.answer,
        options: options ? JSON.stringify(options) : question.options,
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
    const id = parseInt(String(req.params.id));
    const question = await prisma.question.findUnique({
      where: { id },
      include: { subject: true },
    });

    if (!question || question.subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    await prisma.question.delete({ where: { id } });
    res.json({ message: 'Question deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
