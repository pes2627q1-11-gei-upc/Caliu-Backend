import { Router } from 'express';
import { createChatSession, postChatMessage } from '../controllers/chat.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';
import { chatRateLimiter } from '../middlewares/chatRateLimit.js';

const router = Router();
router.use(noStore, requireAuth, chatRateLimiter);
router.post('/sessions', createChatSession);
router.post('/messages', postChatMessage);

export default router;
