import { Router } from 'express';
import { getMe, updateMe, getPreferences, replacePreferences } from '../controllers/users.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';

const router = Router();
router.use(noStore, requireAuth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/me/preferences', getPreferences);
router.put('/me/preferences', replacePreferences);

export default router;
