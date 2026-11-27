import { Router } from 'express';
import {
  createChatSession, listChatMessages, listChatSessions, postChatMessage,
} from '../controllers/chat.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';
import { chatRateLimiter } from '../middlewares/chatRateLimit.js';

const router = Router();
router.use(noStore, requireAuth);
// El límit de 10 per minut només compta les peticions que creen dades (o criden Gemini):
// consultar l'historial no gasta missatges.
router.get('/sessions', listChatSessions);
router.get('/sessions/:id/messages', listChatMessages);
router.post('/sessions', chatRateLimiter, createChatSession);
router.post('/messages', chatRateLimiter, postChatMessage);

export default router;
