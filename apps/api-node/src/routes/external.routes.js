import { Router } from 'express';
import { listExternalEvents } from '../controllers/external.controller.js';
import { createApiKeyAuth } from '../middlewares/apiKeyAuth.js';

// API per a clients externs (altres equips de PES). Totes les rutes exigeixen X-API-Key (#212).
const router = Router();
router.use(createApiKeyAuth());
router.get('/events', listExternalEvents);

export default router;
