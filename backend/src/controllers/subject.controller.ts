import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

export const getSubjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjects = await prisma.subject.findMany({
      where: { teacherId: req.user!.id },
      include: { _count: { select: { questions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(subjects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getLearningOutcomesBySubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });

    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const outcomes = await prisma.learningOutcome.findMany({
      where: { subjectId },
      include: {
        _count: { select: { questions: true } },
      },
      orderBy: { code: 'asc' },
    });

    res.json(outcomes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createLearningOutcome = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const { code, description } = req.body as { code: string; description: string };

    if (!code || !description) {
      res.status(400).json({ error: 'code and description are required' });
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const created = await prisma.learningOutcome.create({
      data: {
        subjectId,
        code: code.trim().toUpperCase(),
        description: description.trim(),
      },
    });

    res.status(201).json(created);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      res.status(409).json({ error: 'Learning outcome code already exists for this subject' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateLearningOutcome = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const outcomeId = parseInt(String(req.params.outcomeId), 10);
    const { code, description } = req.body as { code?: string; description?: string };

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const existing = await prisma.learningOutcome.findUnique({ where: { id: outcomeId } });
    if (!existing || existing.subjectId !== subjectId) {
      res.status(404).json({ error: 'Learning outcome not found' });
      return;
    }

    const updated = await prisma.learningOutcome.update({
      where: { id: outcomeId },
      data: {
        code: code ? code.trim().toUpperCase() : undefined,
        description: description?.trim(),
      },
    });

    res.json(updated);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      res.status(409).json({ error: 'Learning outcome code already exists for this subject' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteLearningOutcome = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const outcomeId = parseInt(String(req.params.outcomeId), 10);

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const existing = await prisma.learningOutcome.findUnique({ where: { id: outcomeId } });
    if (!existing || existing.subjectId !== subjectId) {
      res.status(404).json({ error: 'Learning outcome not found' });
      return;
    }

    const questionCount = await prisma.question.count({
      where: { learningOutcomeId: outcomeId },
    });

    if (questionCount > 0) {
      res.status(400).json({ error: 'Cannot delete learning outcome because it is used by questions' });
      return;
    }

    await prisma.learningOutcome.delete({ where: { id: outcomeId } });
    res.json({ message: 'Learning outcome deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getQuestionStatsByOutcome = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const subjectId = parseInt(String(req.params.subjectId), 10);
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });

    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const outcomes = await prisma.learningOutcome.findMany({
      where: { subjectId },
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    res.json(
      outcomes.map((o) => ({
        id: o.id,
        code: o.code,
        description: o.description,
        questionCount: o._count.questions,
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Subject name is required' });
      return;
    }

    const subject = await prisma.subject.create({
      data: { name, teacherId: req.user!.id },
      include: { _count: { select: { questions: true } } },
    });
    res.status(201).json(subject);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const subject = await prisma.subject.findUnique({ where: { id } });

    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const updated = await prisma.subject.update({
      where: { id },
      data: { name: req.body.name },
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const subject = await prisma.subject.findUnique({ where: { id } });

    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    await prisma.subject.delete({ where: { id } });
    res.json({ message: 'Subject deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
