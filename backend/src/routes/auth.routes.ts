import { Router, type Router as ExpressRouter } from 'express';
import { login, getMe, changePassword } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router: ExpressRouter = Router();

router.post('/login', login);
router.get('/me', authenticate, getMe);
router.post('/change-password', authenticate, changePassword);

export default router;
