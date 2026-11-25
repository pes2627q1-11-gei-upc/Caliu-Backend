import { Router } from 'express';
import { getEvent, listCategories, listLocations, listEvents, nearbyEvents, searchEvents } from '../controllers/events.controller.js';
import { getEventMobility } from '../controllers/mobility.controller.js';

import { authenticateEventReader } from '../middlewares/auth.js';

const router = Router();

router.get('/', authenticateEventReader, listEvents);
router.get('/categories', listCategories); // ha d'anar ABANS de '/:id'
router.get('/locations', listLocations);
router.get('/search', searchEvents); // ha d'anar ABANS de '/:id'
router.get('/nearby', nearbyEvents); // ha d'anar ABANS de '/:id'
router.get('/:id/mobility', getEventMobility); // com arribar-hi (WayGo, #226)
router.get('/:id', authenticateEventReader, getEvent);

export default router;
