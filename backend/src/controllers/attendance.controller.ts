import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

const formatSessionName = (date: Date): string =>
  date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const getSessionsByClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = parseInt(String(req.params.classId));
    const cls = await prisma.class.findUnique({ where: { id: classId } });

    if (!cls || cls.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const sessions = await prisma.attendanceSession.findMany({
      where: { classId },
      include: { _count: { select: { records: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json(sessions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getClassAttendanceSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = parseInt(String(req.params.classId), 10);
    const cls = await prisma.class.findUnique({ where: { id: classId } });

    if (!cls || cls.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const sessions = await prisma.attendanceSession.findMany({
      where: { classId },
      orderBy: { createdAt: 'asc' },
    });

    const students = await prisma.classStudent.findMany({
      where: { classId },
      include: { student: { select: { id: true, username: true, fullName: true } } },
    });

    const records = await prisma.attendanceRecord.findMany({
      where: { sessionId: { in: sessions.map((s: { id: number }) => s.id) } },
      select: { sessionId: true, studentId: true, isPresent: true },
    });

    const recordMap = new Map<string, { isPresent: boolean }>();
    for (const record of records) {
      recordMap.set(`${record.sessionId}:${record.studentId}`, { isPresent: record.isPresent });
    }

    const sessionSummaries = sessions.map((s: { id: number; name?: string | null; status: string; startedAt: Date }) => ({
      id: s.id,
      name: (s as { name?: string | null }).name || formatSessionName(s.startedAt),
      status: s.status,
      startedAt: s.startedAt,
    }));

    const totalLessons = sessions.length;

    const studentSummaries = students.map((item: { student: { id: number; username: string; fullName: string } }) => {
      const student = item.student;
      let present = 0;
      const details = sessions.map((s: { id: number; status: string }) => {
        const key = `${s.id}:${student.id}`;
        const record = recordMap.get(key) as { isPresent: boolean } | undefined;

        if (s.status === 'ACTIVE') {
          return { sessionId: s.id, status: 'ACTIVE' } as const;
        }

        if (record?.isPresent) {
          present += 1;
          return { sessionId: s.id, status: 'PRESENT' } as const;
        }

        return { sessionId: s.id, status: 'ABSENT' } as const;
      });

      return {
        student,
        totalLessons,
        present,
        absent: Math.max(totalLessons - present, 0),
        details,
      };
    });

    res.json({
      classId,
      sessions: sessionSummaries,
      students: studentSummaries,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSessionStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const session = await prisma.attendanceSession.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (req.user?.role === 'TEACHER' && session.class.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (req.user?.role === 'STUDENT') {
      const enrolled = await prisma.classStudent.findUnique({
        where: { classId_studentId: { classId: session.classId, studentId: req.user!.id } },
      });
      if (!enrolled) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
    }

    const sessionName = (session as { name?: string | null }).name;

    res.json({
      id: session.id,
      classId: session.classId,
      status: session.status,
      method: session.method ?? 'CODE',
      name: sessionName,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const endSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const session = await prisma.attendanceSession.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.class.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updated = await prisma.attendanceSession.update({
      where: { id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const renameSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id));
    const { name } = req.body as { name?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const session = await prisma.attendanceSession.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!session || session.class.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const updated = await prisma.attendanceSession.update({
      where: { id },
      data: { name: name.trim() } as any,
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id));
    const session = await prisma.attendanceSession.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!session || session.class.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await prisma.attendanceSession.delete({ where: { id } });
    res.json({ message: 'Session deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSessionRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(String(req.params.id), 10);
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });

    if (!session || session.class.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const records = await prisma.attendanceRecord.findMany({
      where: { sessionId },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
      },
    });

    const allStudents = await prisma.classStudent.findMany({
      where: { classId: session.classId },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
      },
    });

    const recordMap = new Map<number, { isPresent: boolean }>();
    for (const record of records as { studentId: number; isPresent: boolean }[]) {
      recordMap.set(record.studentId, { isPresent: record.isPresent });
    }
    const result = allStudents.map((item: { student: { id: number; username: string; fullName: string } }) => {
      const student = item.student;
      const record = recordMap.get(student.id);
      return {
        student,
        isPresent: record?.isPresent ?? false,
        submitted: !!record,
      };
    });

    res.json({ session, records: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getStudentAttendanceRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(String(req.params.id));
    const studentId = req.user!.id;

    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const enrolled = await prisma.classStudent.findUnique({
      where: { classId_studentId: { classId: session.classId, studentId } },
    });
    if (!enrolled) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const record = await prisma.attendanceRecord.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    if (!record) {
      res.json({ submitted: false, isPresent: false });
      return;
    }

    res.json({ submitted: true, isPresent: record.isPresent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create a face-recognition attendance session (no rolling codes).
 */
export const createFaceSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, name } = req.body;
    if (!classId) {
      res.status(400).json({ error: 'classId is required' });
      return;
    }

    const cls = await prisma.class.findUnique({ where: { id: parseInt(classId) } });
    if (!cls || cls.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    // Check if there's an active session already
    const existingActive = await prisma.attendanceSession.findFirst({
      where: { classId: parseInt(classId), status: 'ACTIVE' },
    });
    if (existingActive) {
      res.status(400).json({ error: 'A session is already active for this class' });
      return;
    }

    const session = await prisma.attendanceSession.create({
      data: {
        classId: parseInt(classId),
        name: name?.trim() || formatSessionName(new Date()),
        codes: '[]', // No codes for face sessions
        method: 'FACE',
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });

    res.status(201).json({
      ...session,
      method: 'FACE',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Submit face-recognized attendance — bulk-mark matched students as present.
 * Body: { studentIds: number[] }
 */
export const submitFaceAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(String(req.params.id), 10);
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      res.status(400).json({ error: 'studentIds array is required' });
      return;
    }

    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: true },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.class.teacherId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (session.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    // Verify all students are enrolled in the class
    const enrolledStudents = await prisma.classStudent.findMany({
      where: {
        classId: session.classId,
        studentId: { in: studentIds.map((id: number) => parseInt(String(id))) },
      },
    });
    const enrolledIds = new Set(enrolledStudents.map((e: { studentId: number }) => e.studentId));

    const results: { studentId: number; marked: boolean }[] = [];

    for (const sid of studentIds) {
      const studentId = parseInt(String(sid));
      if (!enrolledIds.has(studentId)) {
        results.push({ studentId, marked: false });
        continue;
      }

      // Upsert attendance record
      await prisma.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId, studentId } },
        create: {
          sessionId,
          studentId,
          codesEntered: JSON.stringify({ face: true }),
          isPresent: true,
        },
        update: {
          isPresent: true,
          codesEntered: JSON.stringify({ face: true }),
        },
      });

      results.push({ studentId, marked: true });
    }

    const markedCount = results.filter((r) => r.marked).length;

    res.json({
      success: true,
      message: `Marked ${markedCount} student(s) as present via face recognition`,
      markedCount,
      results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
