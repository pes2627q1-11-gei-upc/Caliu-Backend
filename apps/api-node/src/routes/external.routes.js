import { Router } from 'express';
import { listExternalEvents } from '../controllers/external.controller.js';
import { createApiKeyAuth, parseApiKeys } from '../middlewares/apiKeyAuth.js';

// Clau d'API dels clients externs (#212). Si EXTERNAL_API_KEYS està mal configurada, només es
// desactiva l'API externa (503) i es deixa constància als logs: l'API de l'app mòbil ha de
// continuar funcionant. El missatge d'error no inclou cap clau.
export function externalApiAuth(keys = process.env.EXTERNAL_API_KEYS) {
  try {
    return createApiKeyAuth(parseApiKeys(keys));
  } catch (err) {
    console.error(`API externa desactivada: ${err.message}`);
    return (_req, res) => res.status(503).json({ error: 'API externa no disponible' });
  }
}

// API per a clients externs (altres equips de PES). Totes les rutes exigeixen X-API-Key.
const router = Router();
router.use(externalApiAuth());
router.get('/events', listExternalEvents);

export default router;
