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
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    text = await response.text();
  } catch {
    throw httpError(502, 'El servei de xatbot no està disponible');
  }

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw httpError(502, 'El servei de xatbot ha fallat');
    }
  }
  if (!response.ok) {
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw httpError(status, status === 401 ? 'Sessió no vàlida' : 'El servei de xatbot ha fallat');
  }
  return payload;
}
