import { Router } from 'express';
import {
  enrollFace,
  getClassDescriptors,
  deleteFaceData,
  getFaceStatus,
} from '../controllers/face.controller';
import { authenticate, requireRole, requireApproved } from '../middleware/auth';

const router = Router();
router.use(authenticate, requireApproved);

// All face routes are teacher-only
router.post('/enroll', requireRole('TEACHER'), enrollFace);
router.get('/descriptors/:classId', requireRole('TEACHER'), getClassDescriptors);
router.delete('/descriptors/:studentId', requireRole('TEACHER'), deleteFaceData);
router.get('/status/:studentId', requireRole('TEACHER'), getFaceStatus);

export default router;
