import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

export const getClasses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classes = await prisma.class.findMany({
      where: { teacherId: req.user!.id },
      include: {
        _count: { select: { students: true, sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllClasses = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classes = await prisma.class.findMany({
      include: {
        teacher: { select: { id: true, fullName: true, username: true } },
        _count: { select: { students: true, sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(classes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, teacherId } = req.body;
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only admins can create courses' });
      return;
    }

    if (!name) {
      res.status(400).json({ error: 'Class name is required' });
      return;
    }

    const assignedTeacherId = parseInt(teacherId, 10);

    if (!assignedTeacherId || isNaN(assignedTeacherId)) {
      res.status(400).json({ error: 'teacherId is required' });
      return;
    }

    // Verify teacher exists and is approved
    const teacher = await prisma.user.findUnique({ where: { id: assignedTeacherId } });
    if (!teacher || teacher.role !== 'TEACHER' || teacher.status !== 'APPROVED') {
      res.status(400).json({ error: 'Invalid or unapproved teacher' });
      return;
    }

    const newClass = await prisma.class.create({
      data: { name, description, teacherId: assignedTeacherId },
      include: {
        teacher: { select: { id: true, fullName: true, username: true } },
        _count: { select: { students: true, sessions: true } },
      },
    });
    res.status(201).json(newClass);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getClassById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const cls = await prisma.class.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, fullName: true, username: true } },
        students: {
          include: {
            student: { select: { id: true, username: true, fullName: true } },
          },
        },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { students: true, sessions: true } },
      },
    });

    if (!cls) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    // Access check
    if (req.user!.role === 'TEACHER' && cls.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (req.user!.role === 'STUDENT') {
      const enrolled = cls.students.some((s: { studentId: number }) => s.studentId === req.user!.id);
      if (!enrolled) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    }

    res.json(cls);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const cls = await prisma.class.findUnique({ where: { id } });

    if (!cls) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }
    // Admin can update any class; teacher only their own
    if (req.user!.role !== 'ADMIN' && cls.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updated = await prisma.class.update({
      where: { id },
      data: { name: req.body.name, description: req.body.description },
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const cls = await prisma.class.findUnique({ where: { id } });

    if (!cls) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.examSession.deleteMany({ where: { classId: id } });
      await tx.attendanceSession.deleteMany({ where: { classId: id } });
      await tx.classStudent.deleteMany({ where: { classId: id } });
      await tx.class.delete({ where: { id } });
    });

    res.json({ message: 'Class deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = parseInt(String(req.params.id), 10);
    const { studentIds } = req.body as { studentIds: string[] };

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      res.status(400).json({ error: 'studentIds array is required' });
      return;
    }

    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    if (req.user!.role !== 'ADMIN' && cls.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const results = { added: [] as string[], notFound: [] as string[], alreadyEnrolled: [] as string[] };

    for (const sid of studentIds) {
      const student = await prisma.user.findFirst({
        where: { username: sid.trim(), role: 'STUDENT' },
      });

      if (!student) {
        results.notFound.push(sid.trim());
        continue;
      }

      const existing = await prisma.classStudent.findUnique({
        where: { classId_studentId: { classId, studentId: student.id } },
      });

      if (existing) {
        results.alreadyEnrolled.push(sid.trim());
        continue;
      }

      await prisma.classStudent.create({ data: { classId, studentId: student.id } });
      results.added.push(sid.trim());
    }

    res.json({
      message: `Processed ${studentIds.length} student IDs`,
      ...results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = parseInt(String(req.params.id), 10);
    const studentId = parseInt(String(req.params.studentId), 10);

    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    if (req.user!.role !== 'ADMIN' && cls.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await prisma.classStudent.delete({
      where: { classId_studentId: { classId, studentId } },
    });

    res.json({ message: 'Student removed from class' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getStudentClasses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.user!.id;
    const enrollments = await prisma.classStudent.findMany({
      where: { studentId },
      include: {
        class: {
          include: {
            teacher: { select: { id: true, fullName: true, username: true } },
            _count: { select: { students: true, sessions: true } },
          },
        },
      },
    });
    res.json(enrollments.map((e: { class: unknown }) => e.class));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addStudentsByClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const courseId = parseInt(String(req.params.id));
    const { studentClassId } = req.body;

    if (!studentClassId) {
      res.status(400).json({ error: 'studentClassId is required' });
      return;
    }

    const course = await prisma.class.findUnique({ where: { id: courseId } });
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }

    // Get all students in the selected class (cohort)
    const classStudents = await prisma.user.findMany({
      where: { role: 'STUDENT', studentClassId: parseInt(studentClassId) },
      select: { id: true, username: true },
    });

    if (classStudents.length === 0) {
      res.status(400).json({ error: 'No students found in the selected class' });
      return;
    }

    let added = 0;
    let alreadyEnrolled = 0;

    for (const student of classStudents) {
      const existing = await prisma.classStudent.findUnique({
        where: { classId_studentId: { classId: courseId, studentId: student.id } },
      });
      if (existing) {
        alreadyEnrolled++;
        continue;
      }
      await prisma.classStudent.create({ data: { classId: courseId, studentId: student.id } });
      added++;
    }

    res.json({
      message: `Added ${added} students from class. ${alreadyEnrolled} already enrolled.`,
      added,
      alreadyEnrolled,
      total: classStudents.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
