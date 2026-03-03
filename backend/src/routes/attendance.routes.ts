import { Router } from 'express';
import {
  createSession,
  getSessionsByClass,
  getSessionStatus,
  endSession,
  submitCode,
  getSessionRecords,
  getActiveSessionsForStudent,
  getStudentAttendanceRecord,
} from '../controllers/attendance.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved);

// Teacher routes
router.post('/sessions', requireRole('TEACHER'), createSession);
router.get('/sessions/class/:classId', requireRole('TEACHER'), getSessionsByClass);
router.put('/sessions/:id/end', requireRole('TEACHER'), endSession);
router.get('/sessions/:id/records', requireRole('TEACHER'), getSessionRecords);

// Shared - status (used by both teacher and student)
router.get('/sessions/:id/status', getSessionStatus);

// Student routes
router.post('/sessions/:id/submit', requireRole('STUDENT'), submitCode);
router.get('/sessions/student/active', requireRole('STUDENT'), getActiveSessionsForStudent);
router.get('/sessions/:id/my-record', requireRole('STUDENT'), getStudentAttendanceRecord);

export default router;
