import { EVENT_CATEGORIES } from './eventCategories.js';

// Validació estricta abans de construir qualsevol consulta MongoDB.
export function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function validateFields(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !fields.includes(key))) {
    throw invalid('Camps de la petició no vàlids');
  }
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw invalid('email no vàlid');
  const email = value.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || !domain.includes('.') || domain.split('.').some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw invalid('email no vàlid');
  }
  return email;
}

export function validateCredentials(body, registration = false) {
  validateFields(body, registration ? ['username', 'email', 'password'] : ['email', 'password']);
  const email = normalizeEmail(body.email);
  return { email, password: validatePassword(body.password) };
}

export function validatePassword(password) {
  // bcrypt limita l'entrada a 72 bytes: rebutgem, mai truncem silenciosament.
  if (typeof password !== 'string' || [...password].length < 8
    || Buffer.byteLength(password, 'utf8') > 72 || !password.trim()
    || /\p{Cc}/u.test(password)) {
    throw invalid('password ha de tenir almenys 8 caràcters i com a màxim 72 bytes UTF-8, sense controls');
  }
  return password;
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') throw invalid('username no vàlid');
  const username = value.trim().normalize('NFC');
  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) {
    throw invalid('username ha de tenir entre 3 i 30 lletres, números, punts, guions o guions baixos');
  }
  return username;
}

export function validateUsername(body) {
  validateFields(body, ['username']);
  return normalizeUsername(body.username);
}

const categoryKey = (value) => value.trim().normalize('NFC').toLocaleLowerCase('ca');
const categories = new Map(EVENT_CATEGORIES.map((value) => [categoryKey(value), value]));

export function validatePreferences(body) {
  validateFields(body, ['preferences', 'proximitatKm']);
  if (!Array.isArray(body.preferences) || body.preferences.length > 30) {
    throw invalid('preferences ha de ser una llista de com a màxim 30 elements');
  }
  const seen = new Set();
  return body.preferences.reduce((result, value) => {
    if (typeof value !== 'string') throw invalid('Preferència no vàlida');
    const preference = value.trim().normalize('NFC');
    if (!preference || [...preference].length > 50 || /[\p{Cc}\p{Cf}]/u.test(preference)) {
      throw invalid('Cada preferència ha de tenir entre 1 i 50 caràcters, sense controls');
    }
    const key = categoryKey(preference);
    const canonical = categories.get(key);
    if (!canonical) throw invalid('Preferència desconeguda; consulta /events/categories');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(canonical);
    }
    return result;
  }, []);
}

// Radi d'activitat (#123): mateixos límits que radiusKm de GET /events. null l'esborra.
export function validateProximitatKm(value) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.1 || value > 500) {
    throw invalid('proximitatKm ha de ser un número entre 0.1 i 500, o null');
  }
  return value;
}
