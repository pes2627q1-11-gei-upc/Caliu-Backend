// CORS per a Flutter Web (testing des del navegador).
//
// L'app Android no en necessita: CORS només l'apliquen els navegadors. Per això està
// desactivat per defecte i només s'activa per als orígens de CORS_ORIGINS (separats per comes),
// p. ex. "http://localhost:5000,https://pes2627q1-11-gei-upc.github.io".
//
// Implementació pròpia (sense el paquet `cors`) perquè només cal una llista blanca d'orígens.

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Authorization,Content-Type';
const MAX_AGE_SECONDS = '600';

export function parseOrigins(value = '') {
  return String(value)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function createCors(origins = parseOrigins(process.env.CORS_ORIGINS)) {
  const allowed = new Set(origins);

  return function cors(req, res, next) {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return next();

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.append('Vary', 'Origin');

    // Preflight: el navegador pregunta abans d'enviar Authorization o JSON.
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);
      return res.sendStatus(204);
    }
    return next();
  };
}
