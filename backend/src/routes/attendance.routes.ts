import { Router, type Router as ExpressRouter } from 'express';
import {
  getSessionsByClass,
  getClassAttendanceSummary,
  getSessionStatus,
  endSession,
  createFaceSession,
  submitFaceAttendance,
  getSessionRecords,
  getStudentAttendanceRecord,
  renameSession,
  deleteSession,
} from '../controllers/attendance.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router: ExpressRouter = Router();
router.use(authenticate, requireApproved);

// Teacher routes
router.post('/sessions/face', requireRole('TEACHER'), createFaceSession);
router.get('/sessions/class/:classId', requireRole('TEACHER'), getSessionsByClass);
router.get('/sessions/class/:classId/summary', requireRole('TEACHER'), getClassAttendanceSummary);
router.put('/sessions/:id/end', requireRole('TEACHER'), endSession);
router.put('/sessions/:id', requireRole('TEACHER'), renameSession);
router.delete('/sessions/:id', requireRole('TEACHER'), deleteSession);
router.get('/sessions/:id/records', requireRole('TEACHER'), getSessionRecords);
router.post('/sessions/:id/face-submit', requireRole('TEACHER'), submitFaceAttendance);

// Shared - status (used by both teacher and student)
router.get('/sessions/:id/status', getSessionStatus);

// Student routes
router.get('/sessions/:id/my-record', requireRole('STUDENT'), getStudentAttendanceRecord);

export default router;
