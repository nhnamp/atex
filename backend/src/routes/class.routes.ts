import { Router } from 'express';
import {
  getClasses,
  getAllClasses,
  createClass,
  getClassById,
  updateClass,
  deleteClass,
  addStudents,
  addStudentsByClass,
  removeStudent,
  getStudentClasses,
} from '../controllers/class.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved);

// Admin routes
router.get('/all', requireRole('ADMIN'), getAllClasses);
router.post('/', requireRole('ADMIN'), createClass);

// Teacher routes
router.get('/', requireRole('TEACHER'), getClasses);
router.get('/:id', requireRole('TEACHER', 'STUDENT', 'ADMIN'), getClassById);
router.put('/:id', requireRole('TEACHER', 'ADMIN'), updateClass);
router.delete('/:id', requireRole('TEACHER', 'ADMIN'), deleteClass);
router.post('/:id/students', requireRole('ADMIN'), addStudents);
router.post('/:id/students/by-class', requireRole('ADMIN'), addStudentsByClass);
router.delete('/:id/students/:studentId', requireRole('ADMIN'), removeStudent);

// Student routes
router.get('/student/enrolled', requireRole('STUDENT'), getStudentClasses);

export default router;
