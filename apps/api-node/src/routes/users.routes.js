import { Router } from 'express';
import { getMe, updateMe, getPreferences, replacePreferences } from '../controllers/users.controller.js';
import { addFavorite, listActivity, listAttended, listFavorites, removeFavorite, updateFavoriteAlerts } from '../controllers/favorites.controller.js';
import { noStore, requireAuth } from '../middlewares/auth.js';

const router = Router();
router.use(noStore, requireAuth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/me/preferences', getPreferences);
router.put('/me/preferences', replacePreferences);

router.get('/me/activity', listActivity);
router.get('/me/attended', listAttended);
router.get('/me/favorites', listFavorites);
router.post('/me/favorites', addFavorite);
router.patch('/me/favorites/:eventId', updateFavoriteAlerts);
router.delete('/me/favorites/:eventId', removeFavorite);

export default router;
