import { Router } from 'express';
import {
  createLearningOutcome,
  getSubjects,
  getLearningOutcomesBySubject,
  getQuestionStatsByOutcome,
  createSubject,
  deleteSubject,
  deleteLearningOutcome,
  updateLearningOutcome,
  updateSubject,
} from '../controllers/subject.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved, requireRole('TEACHER'));

router.get('/', getSubjects);
router.post('/', createSubject);
router.put('/:id', updateSubject);
router.delete('/:id', deleteSubject);
router.get('/:subjectId/outcomes', getLearningOutcomesBySubject);
router.post('/:subjectId/outcomes', createLearningOutcome);
router.put('/:subjectId/outcomes/:outcomeId', updateLearningOutcome);
router.delete('/:subjectId/outcomes/:outcomeId', deleteLearningOutcome);
router.get('/:subjectId/outcome-stats', getQuestionStatsByOutcome);

export default router;
