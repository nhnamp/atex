import { Router } from 'express';
import {
  getClasses,
  createClass,
  getClassById,
  updateClass,
  deleteClass,
  addStudents,
  removeStudent,
  getStudentClasses,
} from '../controllers/class.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved);

// Teacher routes
router.get('/', requireRole('TEACHER'), getClasses);
router.post('/', requireRole('TEACHER'), createClass);
router.get('/:id', requireRole('TEACHER', 'STUDENT'), getClassById);
router.put('/:id', requireRole('TEACHER'), updateClass);
router.delete('/:id', requireRole('TEACHER'), deleteClass);
router.post('/:id/students', requireRole('TEACHER'), addStudents);
router.delete('/:id/students/:studentId', requireRole('TEACHER'), removeStudent);

// Student routes
router.get('/student/enrolled', requireRole('STUDENT'), getStudentClasses);

export default router;
