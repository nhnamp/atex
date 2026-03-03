import { Router } from 'express';
import {
  getQuestionsBySubject,
  createQuestion,
  updateQuestion,
  deleteQuestion,
} from '../controllers/question.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved, requireRole('TEACHER'));

router.get('/subject/:subjectId', getQuestionsBySubject);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

export default router;
