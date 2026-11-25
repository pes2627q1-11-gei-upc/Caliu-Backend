import { forgotPassword, resetPassword } from '../controllers/passwordReset.controller.js';
import { Router } from 'express';
import { register, login, logout } from '../controllers/auth.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';
import { authLimiter, createAuthLimiter } from '../middlewares/authRateLimit.js';

const router = Router();
router.use(noStore);
router.post('/forgot-password', createAuthLimiter({ limit: 5 }), forgotPassword);
router.post('/reset-password', createAuthLimiter({ limit: 5 }), resetPassword);
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', requireAuth, logout);

export default router;
