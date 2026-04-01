import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const WARMUP_MS = 10000; // 10-second grace period before first code appears

function getSessionState(startedAt: Date, codes: string[]) {
  const elapsed = Date.now() - new Date(startedAt).getTime();

  // Warmup phase: give students time to load the attendance page
  if (elapsed < WARMUP_MS) {
    return {
      phase: 'WARMUP' as const,
      isExpired: false,
      codeIndex: -1,
      timeLeft: 0,
      warmupLeft: Math.ceil((WARMUP_MS - elapsed) / 1000),
    };
  }

  const activeElapsed = elapsed - WARMUP_MS;
  const codeIndex = Math.floor(activeElapsed / 10000); // 0, 1, 2
  const isExpired = activeElapsed >= 30000;

  if (isExpired || codeIndex >= 3) {
    return { phase: 'ACTIVE' as const, isExpired: true, codeIndex: 2, timeLeft: 0 };
  }

  const timeLeft = Math.max(0, 10 - Math.floor((activeElapsed % 10000) / 1000));
  return { phase: 'ACTIVE' as const, isExpired: false, codeIndex, timeLeft, currentCode: codes[codeIndex] };
}

export const createSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId } = req.body;
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

    const codes = [generateCode(), generateCode(), generateCode()];

    const session = await prisma.attendanceSession.create({
      data: {
        classId: parseInt(classId),
        codes: JSON.stringify(codes),
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });

    // Emit via socket.io
    const io = req.app.get('io');
    if (io) {
      // Instantly push notification to all students in the class
      io.to(`class:${session.classId}`).emit('class:session_started', {
        sessionId: session.id,
        classId: session.classId,
        className: cls.name,
        warmupLeft: WARMUP_MS / 1000,
      });

      // Notify the teacher session view that warmup has begun
      io.to(`session:${session.id}`).emit('session:warmup', {
        sessionId: session.id,
        warmupLeft: WARMUP_MS / 1000,
      });

      // Schedule code emissions after warmup (codes[0] at WARMUP_MS, codes[1] at WARMUP_MS+10s, etc.)
      [0, 1, 2].forEach((i) => {
        setTimeout(() => {
          io.to(`session:${session.id}`).emit('session:code_change', {
            sessionId: session.id,
            currentCode: codes[i],
            codeIndex: i,
            timeLeft: 10,
          });
        }, WARMUP_MS + i * 10000);
      });

      // Schedule session end after warmup + 30s
      setTimeout(async () => {
        const sess = await prisma.attendanceSession.findUnique({ where: { id: session.id } });
        if (sess?.status === 'ACTIVE') {
          await prisma.attendanceSession.update({
            where: { id: session.id },
            data: { status: 'COMPLETED', endedAt: new Date() },
          });
        }
        io.to(`session:${session.id}`).emit('session:ended', { sessionId: session.id });
      }, WARMUP_MS + 30000);
    }

    res.status(201).json({
      ...session,
      codes: JSON.parse(session.codes),
      currentCode: codes[0],
      codeIndex: 0,
      timeLeft: 10,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSessionsByClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = parseInt(String(req.params.classId), 10);
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

    const codes = JSON.parse(session.codes) as string[];
    const isTeacher = req.user?.role === 'TEACHER';

    if (session.status === 'COMPLETED') {
      res.json({
        id: session.id,
        classId: session.classId,
        status: 'COMPLETED',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        totalCodes: 3,
      });
      return;
    }

    const state = getSessionState(session.startedAt, codes);

    if (state.isExpired) {
      // Auto-complete
      await prisma.attendanceSession.update({
        where: { id },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });

      res.json({
        id: session.id,
        classId: session.classId,
        status: 'COMPLETED',
        startedAt: session.startedAt,
        endedAt: new Date(),
        totalCodes: 3,
      });
      return;
    }

    if (state.phase === 'WARMUP') {
      res.json({
        id: session.id,
        classId: session.classId,
        status: 'ACTIVE',
        phase: 'WARMUP',
        warmupLeft: state.warmupLeft,
        codeIndex: -1,
        timeLeft: 0,
        totalCodes: 3,
        startedAt: session.startedAt,
      });
      return;
    }

    res.json({
      id: session.id,
      classId: session.classId,
      status: 'ACTIVE',
      phase: 'ACTIVE',
      currentCode: isTeacher ? state.currentCode : undefined,
      codeIndex: state.codeIndex,
      timeLeft: state.timeLeft,
      totalCodes: 3,
      startedAt: session.startedAt,
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

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${id}`).emit('session:ended', { sessionId: id });
    }

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const submitCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(String(req.params.id), 10);
    const { code } = req.body;
    const studentId = req.user!.id;

    if (!code) {
      res.status(400).json({ error: 'Code is required' });
      return;
    }

    const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    // Verify student is enrolled in the class
    const enrolled = await prisma.classStudent.findUnique({
      where: { classId_studentId: { classId: session.classId, studentId } },
    });
    if (!enrolled) {
      res.status(403).json({ error: 'You are not enrolled in this class' });
      return;
    }

    const codes = JSON.parse(session.codes) as string[];
    const state = getSessionState(session.startedAt, codes);

    if (state.isExpired) {
      res.status(400).json({ error: 'Session has expired' });
      return;
    }

    if (state.phase === 'WARMUP') {
      res.status(400).json({ error: 'Session has not started yet, please wait for the first code' });
      return;
    }

    const { codeIndex } = state;

    // Get or create attendance record
    let record = await prisma.attendanceRecord.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    const codesEntered: Record<string, string> = record
      ? JSON.parse(record.codesEntered)
      : {};

    // Check if already submitted for this code window
    if (codesEntered[codeIndex] !== undefined) {
      res.status(400).json({ error: 'You already submitted a code for this window' });
      return;
    }

    codesEntered[codeIndex] = code;

    // Calculate isPresent
    const isPresent =
      codesEntered['0'] === codes[0] &&
      codesEntered['1'] === codes[1] &&
      codesEntered['2'] === codes[2];

    const isCorrect = code === codes[codeIndex];

    if (record) {
      record = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: { codesEntered: JSON.stringify(codesEntered), isPresent },
      });
    } else {
      record = await prisma.attendanceRecord.create({
        data: {
          sessionId,
          studentId,
          codesEntered: JSON.stringify(codesEntered),
          isPresent,
        },
      });
    }

    const submittedCount = Object.keys(codesEntered).length;

    res.json({
      success: true,
      isCorrect,
      submittedCount,
      isPresent: submittedCount === 3 && isPresent,
      message: isCorrect ? '✅ Correct code!' : '❌ Incorrect code',
    });
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

    // Get all students in the class
    const allStudents = await prisma.classStudent.findMany({
      where: { classId: session.classId },
      include: {
        student: { select: { id: true, username: true, fullName: true } },
      },
    });

    // Merge: students with records + absent students
    const recordMap = new Map(records.map((r) => [r.studentId, r]));
    const result = allStudents.map(({ student }) => {
      const record = recordMap.get(student.id);
      return {
        student,
        isPresent: record?.isPresent ?? false,
        codesEntered: record ? JSON.parse(record.codesEntered) : {},
        submitted: !!record,
      };
    });

    res.json({ session, records: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getActiveSessionsForStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.user!.id;

    const enrollments = await prisma.classStudent.findMany({
      where: { studentId },
      select: { classId: true },
    });

    const classIds = enrollments.map((e) => e.classId);

    const activeSessions = await prisma.attendanceSession.findMany({
      where: { classId: { in: classIds }, status: 'ACTIVE' },
      include: {
        class: { select: { id: true, name: true } },
      },
    });

    // Filter truly active (within warmup + 30s)
    const trulyActive = activeSessions.filter((s) => {
      const elapsed = Date.now() - new Date(s.startedAt).getTime();
      return elapsed < WARMUP_MS + 30000;
    });

    res.json(trulyActive);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getStudentAttendanceRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(String(req.params.id), 10);
    const studentId = req.user!.id;

    const record = await prisma.attendanceRecord.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    if (!record) {
      res.json({ submitted: false, codesEntered: {}, isPresent: false });
      return;
    }

    res.json({
      submitted: true,
      codesEntered: JSON.parse(record.codesEntered),
      isPresent: record.isPresent,
    });
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
    const { classId } = req.body;
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
    const enrolledIds = new Set(enrolledStudents.map((e) => e.studentId));

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
