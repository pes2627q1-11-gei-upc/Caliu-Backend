// Converteix els paràmetres de GET /events (query string) en un filtre de MongoDB.
// És lògica pura (no toca la base de dades), així es pot testejar fàcilment.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class QueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueryError';
    this.status = 400;
  }
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Accepta "a,b" i també ?x=a&x=b
function toList(value) {
  if (value === undefined) return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function parseNumber(value, name, min, max) {
  const text = String(value).trim();
  const n = Number(text);
  if (text === '' || !Number.isFinite(n) || n < min || n > max) {
    throw new QueryError(`Paràmetre "${name}" invàlid (ha de ser un número entre ${min} i ${max})`);
  }
  return n;
}

function parseDate(value, name) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new QueryError(`Paràmetre "${name}" invàlid (format ISO 8601, p. ex. 2026-10-25T00:00:00+02:00)`);
  }
  return d;
}

function parsePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new QueryError(`Paràmetre "${name}" invàlid (enter >= 1)`);
  }
  return n;
}

export function parseEventQuery(query = {}, now = new Date()) {
  const filter = {};

  // --- Dates: un esdeveniment coincideix si el seu interval se solapa amb [from, to].
  // Per defecte (sense "from") només es mostren els que encara no han acabat.
  const from = query.from !== undefined ? parseDate(query.from, 'from') : now;
  const to = query.to !== undefined ? parseDate(query.to, 'to') : null;
  if (to && to < from) throw new QueryError('"to" ha de ser posterior a "from"');
  filter.endDate = { $gte: from };
  if (to) filter.startDate = { $lte: to };

  // --- Categories i etiquetes (coincidència exacta)
  const categories = toList(query.category);
  if (categories.length) filter.categories = { $in: categories };
  const tags = toList(query.tag);
  if (tags.length) filter.tags = { $in: tags };

  // --- Comarca / municipi: nom complet, sense distingir majúscules ni accents.
  // Accepten diversos valors ("a,b" o ?x=a&x=b): l'esdeveniment ha de coincidir amb algun.
  // "municipi" és el nom oficial del paràmetre; "municipality" es manté com a àlies.
  const comarques = toList(query.comarca);
  if (comarques.length) {
    filter.comarca = { $in: comarques.map((v) => accentInsensitiveRegex(v, { exact: true })) };
  }
  const municipis = [...toList(query.municipi), ...toList(query.municipality)];
  if (municipis.length) {
    filter.municipality = { $in: municipis.map((v) => accentInsensitiveRegex(v, { exact: true })) };
  }

  // --- Cerca de text lliure: títol, lloc, municipi o etiquetes
  const q = query.q !== undefined ? String(query.q).trim() : '';
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: rx }, { venue: rx }, { municipality: rx }, { tags: rx }];
  }

  // --- Proximitat
  const hasLat = query.lat !== undefined;
  const hasLng = query.lng !== undefined;
  const hasRadius = query.radiusKm !== undefined;
  if (hasLat !== hasLng) throw new QueryError('Cal enviar "lat" i "lng" junts');
  if (hasRadius && !hasLat) throw new QueryError('"radiusKm" requereix "lat" i "lng"');

  let geo = null;
  if (hasLat) {
    geo = {
      lat: parseNumber(query.lat, 'lat', -90, 90),
      lng: parseNumber(query.lng, 'lng', -180, 180),
      maxDistance: null, // en metres; null = sense límit (només ordena per distància)
    };
    if (hasRadius) geo.maxDistance = parseNumber(query.radiusKm, 'radiusKm', 0.1, 500) * 1000;
  }

  // --- Paginació
  const page = query.page !== undefined ? parsePositiveInt(query.page, 'page') : 1;
  const limit = Math.min(
    query.limit !== undefined ? parsePositiveInt(query.limit, 'limit') : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  return { filter, geo, page, limit, skip: (page - 1) * limit };
}

// --- Cerca per text (GET /events/search) -------------------------------------------------
const MAX_SEARCH_LENGTH = 100;
const MAX_SEARCH_TERMS = 8;

// Lletres que es consideren equivalents amb/sense accent: "musica" troba "Música", "classica" troba "clàssica".
const ACCENT_CLASSES = {
  a: 'aàáâäAÀÁÂÄ',
  e: 'eèéêëEÈÉÊË',
  i: 'iìíîïIÌÍÎÏ',
  o: 'oòóôöOÒÓÔÖ',
  u: 'uùúûüUÙÚÛÜ',
  c: 'cçCÇ',
  n: 'nñNÑ',
};

const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Regex que ignora majúscules i accents. El text de l'usuari s'escapa: mai s'interpreta com a regex.
// Per defecte busca el text com a fragment; amb { exact: true } ha de coincidir amb tot el camp.
export function accentInsensitiveRegex(text, { exact = false } = {}) {
  const escaped = escapeRegex(stripAccents(text));
  const pattern = escaped.replace(/[aeioucn]/gi, (ch) => `[${ACCENT_CLASSES[ch.toLowerCase()]}]`);
  return new RegExp(exact ? `^${pattern}$` : pattern, 'i');
}

// Mateixos filtres, paginació i ordre que GET /events, però amb "q" obligatori i avaluat NOMÉS
// contra el títol i les etiquetes. Cada paraula de "q" ha de coincidir amb el títol O amb alguna
// etiqueta (així "teatre infantil" troba un esdeveniment amb aquestes dues etiquetes).
export function parseSearchQuery(query = {}, now = new Date()) {
  const raw = Array.isArray(query.q) ? query.q.join(' ') : query.q;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new QueryError('Paràmetre "q" obligatori (text a cercar)');
  }
  const q = raw.trim();
  if (q.length > MAX_SEARCH_LENGTH) {
    throw new QueryError(`Paràmetre "q" massa llarg (màxim ${MAX_SEARCH_LENGTH} caràcters)`);
  }

  // "q" no es passa a parseEventQuery: allà també cerca a lloc i municipi, i aquí no volem això.
  const { q: _q, ...rest } = query;
  const parsed = parseEventQuery(rest, now);

  const terms = q.split(/\s+/).slice(0, MAX_SEARCH_TERMS);
  parsed.filter.$and = terms.map((term) => {
    const rx = accentInsensitiveRegex(term);
    return { $or: [{ title: rx }, { tags: rx }] };
  });

  return { ...parsed, q };
}
