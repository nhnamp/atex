import { Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// ── Helper: cascade-delete a user by cleaning up all relations first ──
async function cascadeDeleteUser(id: number): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw new Error('User not found');

    // Delete face descriptors
    await tx.faceDescriptor.deleteMany({ where: { studentId: id } });

    // Delete attendance records
    await tx.attendanceRecord.deleteMany({ where: { studentId: id } });

    // Delete class enrollments
    await tx.classStudent.deleteMany({ where: { studentId: id } });

    if (user.role === 'TEACHER') {
      // For teachers: delete their classes' related data, then classes, then subjects
      const teacherClasses = await tx.class.findMany({ where: { teacherId: id }, select: { id: true } });
      const classIds = teacherClasses.map((c: { id: number }) => c.id);

      if (classIds.length > 0) {
        // Delete attendance records of sessions in these classes
        const sessions = await tx.attendanceSession.findMany({
          where: { classId: { in: classIds } }, select: { id: true },
        });
        const sessionIds = sessions.map((s: { id: number }) => s.id);
        if (sessionIds.length > 0) {
          await tx.attendanceRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
        }
        await tx.attendanceSession.deleteMany({ where: { classId: { in: classIds } } });
        await tx.classStudent.deleteMany({ where: { classId: { in: classIds } } });
        await tx.class.deleteMany({ where: { teacherId: id } });
      }

      // Delete subjects and their questions
      const subjects = await tx.subject.findMany({ where: { teacherId: id }, select: { id: true } });
      const subjectIds = subjects.map((s: { id: number }) => s.id);
      if (subjectIds.length > 0) {
        await tx.question.deleteMany({ where: { subjectId: { in: subjectIds } } });
        await tx.subject.deleteMany({ where: { teacherId: id } });
      }
    }

    await tx.user.delete({ where: { id } });
  });
}

// ── Users ─────────────────────────────────────────────

export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } },
      select: {
        id: true, username: true, fullName: true, role: true, status: true, createdAt: true,
        departmentId: true, studentClassId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.userId as string);
    const { fullName, departmentId, studentClassId } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.role === 'ADMIN') {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const data: any = {};
    if (fullName !== undefined) data.fullName = fullName;
    if (user.role === 'TEACHER' && departmentId !== undefined) {
      data.departmentId = departmentId ? parseInt(departmentId) : null;
    }
    if (user.role === 'STUDENT' && studentClassId !== undefined) {
      data.studentClassId = studentClassId ? parseInt(studentClassId) : null;
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, fullName: true, role: true, status: true, departmentId: true, studentClassId: true },
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.userId as string);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.role === 'ADMIN') {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await cascadeDeleteUser(id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const bulkDeleteUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userIds } = req.body as { userIds: number[] };
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'userIds array is required' });
      return;
    }

    // Filter out admins
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, role: { not: 'ADMIN' } },
      select: { id: true },
    });

    let deleted = 0;
    const errors: string[] = [];

    for (const u of users) {
      try {
        await cascadeDeleteUser(u.id);
        deleted++;
      } catch (err: any) {
        errors.push(`User ${u.id}: ${err.message}`);
      }
    }

    res.json({ message: `Deleted ${deleted} of ${userIds.length} users`, deleted, errors });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Teachers ──────────────────────────────────────────

export const getTeachers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teachers = await prisma.user.findMany({
      where: { role: 'TEACHER', status: 'APPROVED' },
      select: { id: true, username: true, fullName: true, departmentId: true },
      orderBy: { fullName: 'asc' },
    });
    res.json(teachers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, fullName, password, departmentId } = req.body;

    if (!username || !fullName) {
      res.status(400).json({ error: 'username and fullName are required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: `Username "${username}" already exists` });
      return;
    }

    const pass = password || 'teacher123';
    const hashed = await bcrypt.hash(pass, 10);

    const user = await prisma.user.create({
      data: {
        username, password: hashed, fullName,
        role: 'TEACHER', status: 'APPROVED',
        departmentId: departmentId ? parseInt(departmentId) : null,
      },
      select: { id: true, username: true, fullName: true, role: true, status: true, departmentId: true },
    });

    res.status(201).json({ message: 'Teacher created', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Students ──────────────────────────────────────────

export const createStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, fullName, password, studentClassId } = req.body;

    if (!username || !fullName) {
      res.status(400).json({ error: 'username and fullName are required' });
      return;
    }
    if (!/^\d{8}$/.test(username)) {
      res.status(400).json({ error: 'Student username must be exactly 8 digits' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: `Username "${username}" already exists` });
      return;
    }

    const pass = password || username;
    const hashed = await bcrypt.hash(pass, 10);

    const user = await prisma.user.create({
      data: {
        username, password: hashed, fullName,
        role: 'STUDENT', status: 'APPROVED',
        studentClassId: studentClassId ? parseInt(studentClassId) : null,
      },
      select: { id: true, username: true, fullName: true, role: true, status: true, studentClassId: true },
    });

    res.status(201).json({ message: 'Student created', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createStudentsFromExcel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Excel file is required' });
      return;
    }

    const studentClassId = req.body.studentClassId ? parseInt(req.body.studentClassId) : null;

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const results = { created: [] as string[], alreadyExists: [] as string[], invalid: [] as string[] };

    for (const row of rows) {
      const rawUsername = String(row[0] ?? '').trim();
      const fullName = String(row[1] ?? '').trim();
      if (!rawUsername || !fullName) {
        if (rawUsername || fullName) results.invalid.push(rawUsername || '(empty)');
        continue;
      }

      const username = /^\d+$/.test(rawUsername) ? rawUsername.padStart(8, '0') : rawUsername;
      if (!/^\d{8}$/.test(username)) { results.invalid.push(rawUsername); continue; }

      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) { results.alreadyExists.push(username); continue; }

      const hashed = await bcrypt.hash(username, 10);
      await prisma.user.create({
        data: { username, password: hashed, fullName, role: 'STUDENT', status: 'APPROVED', studentClassId },
      });
      results.created.push(username);
    }

    res.json({ message: `Processed ${rows.length} rows`, ...results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Departments ───────────────────────────────────────

export const getDepartments = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      include: { _count: { select: { teachers: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(departments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'Department name is required' }); return; }
    const dept = await prisma.department.create({ data: { name } });
    res.status(201).json(dept);
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: 'Department name already exists' }); return; }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { name } = req.body;
    const dept = await prisma.department.update({ where: { id }, data: { name } });
    res.json(dept);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    await prisma.department.delete({ where: { id } });
    res.json({ message: 'Department deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Student Classes ───────────────────────────────────

export const getStudentClasses = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classes = await prisma.studentClass.findMany({
      include: { _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(classes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createStudentClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'Class name is required' }); return; }
    const cls = await prisma.studentClass.create({ data: { name } });
    res.status(201).json(cls);
  } catch (error: any) {
    if (error.code === 'P2002') { res.status(409).json({ error: 'Class name already exists' }); return; }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateStudentClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { name } = req.body;
    const cls = await prisma.studentClass.update({ where: { id }, data: { name } });
    res.json(cls);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteStudentClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    await prisma.studentClass.delete({ where: { id } });
    res.json({ message: 'Class deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
