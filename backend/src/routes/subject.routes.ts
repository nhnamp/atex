import { Router } from 'express';
import {
  getSubjects,
  createSubject,
  deleteSubject,
  updateSubject,
} from '../controllers/subject.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved, requireRole('TEACHER'));

router.get('/', getSubjects);
router.post('/', createSubject);
router.put('/:id', updateSubject);
router.delete('/:id', deleteSubject);

export default router;
