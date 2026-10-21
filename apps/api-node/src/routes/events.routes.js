import { Router } from 'express';
import { getEvent, listCategories, listEvents, searchEvents } from '../controllers/events.controller.js';

const router = Router();

router.get('/', listEvents);
router.get('/categories', listCategories); // ha d'anar ABANS de '/:id'
router.get('/search', searchEvents); // ha d'anar ABANS de '/:id'
router.get('/:id', getEvent);

export default router;
