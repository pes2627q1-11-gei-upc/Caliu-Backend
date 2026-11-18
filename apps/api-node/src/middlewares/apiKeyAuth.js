import { createHash, timingSafeEqual } from 'node:crypto';

// Autenticació dels clients externs (altres equips de PES, p. ex. Xematrip) amb una clau
// d'API a la capçalera X-API-Key (#212).
//
// Cada client té la seva clau a EXTERNAL_API_KEYS amb el format "nom:clau", separats per comes,
// p. ex. "xematrip:<clau>". Afegir un client nou no requereix tocar codi.
// Sense claus configurades es rebutja tota petició: l'API externa mai queda oberta per error.

const CLIENT_NAME = /^[a-z0-9_-]+$/i;
const MIN_KEY_LENGTH = 32; // el mateix mínim que JWT_SECRET (config/auth.js)

// Resum de mida fixa: timingSafeEqual exigeix dues entrades de la mateixa longitud.
const digest = (value) => createHash('sha256').update(value).digest();

export function parseApiKeys(value = '') {
  const clients = new Map();
  for (const entry of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    const name = entry.slice(0, separator);
    const key = entry.slice(separator + 1);
    if (separator < 1 || !CLIENT_NAME.test(name) || key.length < MIN_KEY_LENGTH || clients.has(name)) {
      throw new Error('EXTERNAL_API_KEYS ha de tenir el format nom:clau separat per comes, '
        + 'amb noms únics i claus d\'almenys 32 caràcters');
    }
    clients.set(name, digest(key));
  }
  return clients;
}

export function createApiKeyAuth(clients = parseApiKeys(process.env.EXTERNAL_API_KEYS)) {
  return function requireApiKey(req, res, next) {
    const key = req.get('X-API-Key');
    if (!key) return res.status(401).json({ error: 'Cal una clau d\'API (capçalera X-API-Key)' });

    // Comparació en temps constant i sense sortir abans: el temps de resposta no revela res.
    const received = digest(key);
    let client = null;
    for (const [name, expected] of clients) {
      if (timingSafeEqual(received, expected)) client = name;
    }
    if (!client) return res.status(401).json({ error: 'Clau d\'API no vàlida' });

    req.apiClient = client;
    return next();
  };
}
