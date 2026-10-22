import { Router } from 'express';
import { register, login, logout } from '../controllers/auth.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';

const router = Router();
router.use(noStore);
router.post('/register', register);
router.post('/login', login);
router.post('/logout', requireAuth, logout);

export default router;
