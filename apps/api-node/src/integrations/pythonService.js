import { verifyAccessToken } from '../domain/auth.js';
import { httpError } from '../domain/httpError.js';

const DEFAULT_PYTHON_TIMEOUT_MS = 60_000;
const MAX_PYTHON_TIMEOUT_MS = 300_000;

function pythonTimeoutMs() {
  const value = process.env.PYTHON_TIMEOUT_MS;
  if (value === undefined || value.trim() === '') return DEFAULT_PYTHON_TIMEOUT_MS;

  const timeout = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(timeout)
    || timeout < 1 || timeout > MAX_PYTHON_TIMEOUT_MS) {
    throw httpError(500, `PYTHON_TIMEOUT_MS ha de ser un enter entre 1 i ${MAX_PYTHON_TIMEOUT_MS}`);
  }
  return timeout;
}

function pythonUrl(path) {
  const base = process.env.PYTHON_SERVICE_URL;
  if (typeof base !== 'string' || !base.trim()) {
    throw httpError(500, 'Falta la variable d\'entorn PYTHON_SERVICE_URL');
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw httpError(500, 'Ruta del servei Python no vàlida');
  }

  let baseUrl;
  let url;
  try {
    baseUrl = new URL(base);
    url = new URL(path, baseUrl);
  } catch {
    throw httpError(500, 'PYTHON_SERVICE_URL no vàlida');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || url.origin !== baseUrl.origin) {
    throw httpError(500, 'Ruta del servei Python no vàlida');
  }
  return url.toString();
}

// Codis que Python pot retornar amb un 503 (#142). Només s'accepten aquests i el missatge el posa Node:
// el cos de la resposta de Python mai no arriba a l'app.
const PYTHON_UNAVAILABLE = {
  CHATBOT_UNAVAILABLE: 'El servei de xatbot no està disponible',
  EVENTS_UNAVAILABLE: 'El servei d\'esdeveniments no està disponible',
};

export async function proxyToPython({ path, method = 'POST', token, body } = {}) {
  // La crida ha d'anar darrere de requireAuth, que també comprova l'usuari i la sessió a MongoDB.
  verifyAccessToken(token);
  const url = pythonUrl(path);
  const timeout = pythonTimeoutMs();

  let response;
  let text;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    text = await response.text();
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw httpError(504, 'El servei de xatbot ha tardat massa a respondre', 'CHATBOT_TIMEOUT');
    }
    throw httpError(503, 'El servei de xatbot no està disponible', 'CHATBOT_UNAVAILABLE');
  }

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw httpError(502, 'El servei de xatbot ha fallat', 'CHATBOT_ERROR');
    }
  }
  if (!response.ok) {
    // Només es mantenen els casos explícits del contracte (OpenAPI, #143): 401 i els 503 amb codi conegut.
    // Qualsevol altre error de Python (400, 404, 422, 500…) és inesperat per a l'app: 502 CHATBOT_ERROR.
    const unavailable = response.status === 503 && Object.hasOwn(PYTHON_UNAVAILABLE, payload?.code);
    if (unavailable) throw httpError(503, PYTHON_UNAVAILABLE[payload.code], payload.code);
    if (response.status === 401) throw httpError(401, 'Sessió no vàlida');
    throw httpError(502, 'El servei de xatbot ha fallat', 'CHATBOT_ERROR');
  }
  return payload;
}
