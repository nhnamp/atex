import { Router } from 'express';
import {
  getPendingTeachers,
  approveTeacher,
  rejectTeacher,
  getAllUsers,
} from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

router.get('/users', getAllUsers);
router.get('/pending-teachers', getPendingTeachers);
router.put('/approve/:userId', approveTeacher);
router.put('/reject/:userId', rejectTeacher);

export default router;
