import { Router } from 'express';
import { getRecommendations } from '../controllers/recommendations.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';

// Recomanacions personalitzades (#120, HU #8): només per a usuaris autenticats.
const router = Router();
router.use(noStore, requireAuth);
router.get('/', getRecommendations);

export default router;
