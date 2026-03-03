import { Router } from 'express';
import { generateExam } from '../controllers/exam.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved, requireRole('TEACHER'));

router.post('/generate', generateExam);

export default router;
