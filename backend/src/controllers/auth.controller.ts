import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

const isBcryptHash = (value: string): boolean =>
  value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$');

const verifyAndUpgradePassword = async (
  userId: number,
  storedPassword: string,
  inputPassword: string
): Promise<boolean> => {
  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(inputPassword, storedPassword);
  }

  if (storedPassword !== inputPassword) {
    return false;
  }

  const hashed = await bcrypt.hash(inputPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
  return true;
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, fullName, role } = req.body;

    if (!username || !password || !fullName || !role) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (!['TEACHER', 'STUDENT'].includes(role)) {
      res.status(400).json({ error: 'Role must be TEACHER or STUDENT' });
      return;
    }

    // Validate student username (8-digit ID)
    if (role === 'STUDENT') {
      if (!/^\d{8}$/.test(username)) {
        res.status(400).json({ error: 'Student username must be exactly 8 digits (student ID)' });
        return;
      }
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    // Check if username exists
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const status = role === 'TEACHER' ? 'PENDING' : 'APPROVED';

    const user = await prisma.user.create({
      data: { username, password: hashed, fullName, role, status },
    });

    res.status(201).json({
      message:
        role === 'TEACHER'
          ? 'Account created! Please wait for admin approval before logging in.'
          : 'Account created successfully!',
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      res.status(401).json({ error: 'Login failed: invalid username or password' });
      return;
    }

    const isMatch = await verifyAndUpgradePassword(user.id, user.password, password);
    if (!isMatch) {
      res.status(401).json({ error: 'Login failed: invalid username or password' });
      return;
    }

    if (user.status === 'PENDING') {
      res.status(403).json({
        error: 'Your account is pending admin approval. Please wait.',
      });
      return;
    }

    if (user.status === 'REJECTED') {
      res.status(403).json({
        error: 'Your account has been rejected. Please contact admin.',
      });
      return;
    }

    const payload = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
    };

    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    } as jwt.SignOptions);

    res.json({
      token,
      user: payload,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isMatch = await verifyAndUpgradePassword(user.id, user.password, currentPassword);
    if (!isMatch) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('ChangePassword error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
