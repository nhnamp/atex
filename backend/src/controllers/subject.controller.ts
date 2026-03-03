import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
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
