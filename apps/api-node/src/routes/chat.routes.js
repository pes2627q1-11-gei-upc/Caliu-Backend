import { Router } from 'express';
import { postChatMessage } from '../controllers/chat.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';
import { chatRateLimiter } from '../middlewares/chatRateLimit.js';

const router = Router();
router.use(noStore, requireAuth, chatRateLimiter);
router.post('/messages', postChatMessage);

export default router;
