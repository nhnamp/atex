import { Router } from 'express';
import {
  getQuestionsBySubject,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  importQuestionsFromExcel,
  previewQuestionsFromExcel,
  downloadTemplate,
} from '../controllers/question.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
router.use(authenticate, requireApproved, requireRole('TEACHER'));

router.get('/template', downloadTemplate);
router.get('/subject/:subjectId', getQuestionsBySubject);
router.post('/subject/:subjectId/preview-excel', upload.single('file'), previewQuestionsFromExcel);
router.post('/subject/:subjectId/import-excel', upload.single('file'), importQuestionsFromExcel);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

export default router;
