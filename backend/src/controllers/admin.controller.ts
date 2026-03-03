import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } },
      select: {
        id: true, username: true, fullName: true, role: true, status: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPendingTeachers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teachers = await prisma.user.findMany({
      where: { role: 'TEACHER', status: 'PENDING' },
      select: {
        id: true, username: true, fullName: true, role: true, status: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(teachers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const approveTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: parseInt(userId) } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (user.role !== 'TEACHER') {
      res.status(400).json({ error: 'User is not a teacher' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { status: 'APPROVED' },
      select: { id: true, username: true, fullName: true, role: true, status: true },
    });

    res.json({ message: 'Teacher account approved', user: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const rejectTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: parseInt(userId) } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { status: 'REJECTED' },
      select: { id: true, username: true, fullName: true, role: true, status: true },
    });

    res.json({ message: 'Teacher account rejected', user: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
