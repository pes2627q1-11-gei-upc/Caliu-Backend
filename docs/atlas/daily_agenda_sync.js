// Atlas App Services -> Triggers -> daily_agenda_sync (Scheduled, cron "0 4 * * *" = 04:00 UTC)
// Copia versionada. Si es toca el trigger a Atlas, actualitzeu també aquest fitxer.
//
// ÚNICA COL·LECCIÓ: aquest trigger escriu directament a `Caliu.esdeveniments` amb el MATEIX
// esquema que llegeix api-node (apps/api-node/src/models/Event.js): code, title, startDate,
// categories, price numèric, images amb URL completa, etc. Ja no hi ha cap pas intermedi: la
// ingesta Python (app/ingest) i la col·lecció `events` s'han eliminat.
//
// La normalització (neteja de text, dates a hora de Barcelona, preu, imatges, categories...) és
// el port a JavaScript de l'antic python-service/app/ingest/{normalize,categories}.py.
// tests/atlasSync.test.js la comprova contra casos "golden" generats amb aquell codi Python.
//
// IMPORTANT: EVENT_CATEGORIES ha de ser idèntic a apps/api-node/src/domain/eventCategories.js
// (el test ho comprova).
//
// DATES: la font (Socrata) dóna `data_inici` com "2026-10-24T22:00:00.000", és a dir hora LOCAL
// de Barcelona sense zona. Aquí es llegeix com a tal i es desa com a instant UTC correcte.
// El càlcul d'horari d'estiu/hivern és manual (UE: últim diumenge de març/octubre a la 01:00 UTC)
// perquè no cal dependre d'`Intl` ni de la zona horària del servidor.

// ---------------------------------------------------------------- configuració
const SOURCE_URL = "https://analisi.transparenciacatalunya.cat/resource/rhpv-yr4f.json";
const WINDOW_DAYS = 7; // CANVIAR si es vol veure més enllà d'una setmana
const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // salvaguarda: 20.000 esdeveniments com a màxim
const BATCH_SIZE = 500;
// Camps que només tenen sentit si la font els té: si desapareixen, s'han d'esborrar.
const OPTIONAL_FIELDS = ["location", "price"];

const IMAGE_BASE = "https://agenda.cultura.gencat.cat"; // `cultura.gencat.cat` dona 404 per a aquests recursos
// Límits aproximats de Catalunya: coordenades fora d'aquí són gairebé segur errors de la font.
const LAT_RANGE = [40.4, 42.95];
const LNG_RANGE = [0.1, 3.4];
const MAX_EVENT_SPAN_DAYS = 3 * 366; // exposicions llargues sí; anys 2924 no
const DESC_MIN_HITS = 2; // coincidències necessàries a la descripció per assignar una categoria

// ---------------------------------------------------------------- categories
const EVENT_CATEGORIES = [
  "Música",
  "Teatre",
  "Gastronomia",
  "Arts",
  "Esports",
  "Menjar i beguda",
  "Nit",
  "Tallers",
  "Comèdia",
  "A l'aire lliure",
];

// Paraules clau (sense accents, minúscules). Per defecte coincideixen com a PREFIX de paraula
// ("concert" -> concert, concerts, concertino). Si acaben en "$" han de ser la paraula exacta.
//   KEYWORDS    : compten al títol/etiquetes i a la descripció
//   TITLE_ONLY  : massa ambigües per a la descripció, només compten al títol/etiquetes
const KEYWORDS = {
  "Música": ["musica", "music$", "musics$", "concert", "jazz", "cobla", "cantada", "havaner", "orquestra",
    "simfonic", "cantautor", "recital", "orgue", "flamenc", "rock$", "dj$", "opera$", "banda$"],
  "Teatre": ["teatre", "titelles", "marionet", "pallass", "circ$", "circense", "dramatitz", "obra de teatre"],
  "Gastronomia": ["gastronom", "tapes$", "formatge", "cuina$", "degustaci", "tast$", "tasts$", "vins$", "vi$", "cervesa", "vermut"],
  "Menjar i beguda": ["gastronom", "tapes$", "formatge", "degustaci", "tast$", "tasts$", "vins$", "vi$", "cervesa", "vermut", "brunch"],
  "Arts": ["exposici", "fotograf", "cinema", "film", "pellicul", "documental", "dansa", "pintura", "escultura",
    "ceramica", "museu", "patrimoni", "arqueolog", "galeria", "art$", "arts$", "artista", "il lustraci",
    "literatura", "poesia", "cultura popular", "castellers", "gegants", "trencadis", "arquitectura"],
  "Esports": ["esport", "cursa", "caminada", "ciclis", "futbol", "senderisme", "triatl", "marato", "escalada", "natacio"],
  "Tallers": ["taller", "curs$", "cursos$", "masterclass", "formacio"],
  "Comèdia": ["comedia", "monoleg", "humor", "stand up", "standup"],
  "A l'aire lliure": ["aire lliure", "platja", "muntanya", "excursi", "senderisme", "a la fresca", "parc natural"],
};
const TITLE_ONLY = {
  "Teatre": ["espectacle"],
  "Arts": ["mostra"],
  "Tallers": ["activitat familiar"],
  "A l'aire lliure": ["ruta", "passeig"],
};
// Un "festival" o un "cicle" sense més pistes NO bastan per classificar: són massa genèrics.

const COMARQUES = {
  "alt-camp": "Alt Camp", "alt-emporda": "Alt Empordà", "alt-penedes": "Alt Penedès",
  "alt-urgell": "Alt Urgell", "alta-ribagorca": "Alta Ribagorça", "anoia": "Anoia",
  "bages": "Bages", "baix-camp": "Baix Camp", "baix-ebre": "Baix Ebre",
  "baix-emporda": "Baix Empordà", "baix-llobregat": "Baix Llobregat",
  "baix-penedes": "Baix Penedès", "barcelones": "Barcelonès", "bergueda": "Berguedà",
  "cerdanya": "Cerdanya", "conca-de-barbera": "Conca de Barberà", "garraf": "Garraf",
  "garrigues": "Garrigues", "garrotxa": "Garrotxa", "girones": "Gironès",
  "maresme": "Maresme", "montsia": "Montsià", "noguera": "Noguera", "osona": "Osona",
  "pallars-jussa": "Pallars Jussà", "pallars-sobira": "Pallars Sobirà",
  "pla-d-urgell": "Pla d'Urgell", "pla-de-l-estany": "Pla de l'Estany",
  "priorat": "Priorat", "ribera-d-ebre": "Ribera d'Ebre", "ripolles": "Ripollès",
  "segarra": "Segarra", "segria": "Segrià", "selva": "Selva", "solsones": "Solsonès",
  "tarragones": "Tarragonès", "terra-alta": "Terra Alta", "urgell": "Urgell",
  "val-d-aran": "Val d'Aran", "valles-occidental": "Vallès Occidental",
  "valles-oriental": "Vallès Oriental", "moianes": "Moianès",
  "lluces": "Lluçanès",
};

const TAG_LABELS = {
  "concerts": "Concerts", "musica": "Música", "musica-classica": "Música clàssica",
  "jazz": "Jazz", "teatre": "Teatre", "dansa": "Dansa", "exposicions": "Exposicions",
  "cinema": "Cinema", "festes-populars": "Festes populars", "familiar": "Família",
  "infantil": "Infantil", "tallers": "Tallers", "cultura-popular-i-tradicional": "Cultura popular",
  "literatura": "Literatura", "cicles": "Cicles", "fires": "Fires",
  "festivals-i-mostres": "Festivals i mostres", "rutes-i-visites": "Rutes i visites",
  "activitats-virtuals": "Activitats virtuals", "conferencies": "Conferències", "festes": "Festes",
  "gegants": "Gegants", "espectacles": "Espectacles", "divulgacio": "Divulgació",
};

const PARTICLES = ["de", "del", "dels", "la", "les", "el", "els", "i", "al", "a", "en", "sa", "ses", "es"];

// Entitats HTML habituals a les descripcions (subconjunt; les desconegudes es deixen tal qual).
const HTML_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", deg: "°",
  laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“",
  rdquo: "”", euro: "€", middot: "·", bull: "•", times: "×",
  agrave: "à", aacute: "á", acirc: "â", auml: "ä", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", ograve: "ò", oacute: "ó", ocirc: "ô", ouml: "ö",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", ccedil: "ç", ntilde: "ñ",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Auml: "Ä", Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Ouml: "Ö",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Ccedil: "Ç", Ntilde: "Ñ", szlig: "ß",
};

// ---------------------------------------------------------------- helpers de text
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAccents(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, "");
}

function unescapeHtml(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, body) ? HTML_ENTITIES[body] : whole;
  });
}

// Treu HTML, desfà entitats (&amp;...) i normalitza espais.
function cleanText(value) {
  if (value === null || value === undefined) return "";
  let text = String(value).replace(/<br\s*\/?>|<\/p>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = unescapeHtml(text);
  text = text.replace(/[ \t\r\f\v]+/g, " ");
  text = text.replace(/\n\s*\n+/g, "\n\n");
  return text.trim();
}

function capitalize(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// 'vilafranca-del-penedes' -> 'Vilafranca del Penedes' (els accents NO es poden recuperar).
function slugToLabel(slugIn) {
  const slug = slugIn.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TAG_LABELS, slug)) return TAG_LABELS[slug];
  const words = slug.split(/[-_\s]+/);
  const out = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if ((w === "l" || w === "d") && i + 1 < words.length) { // l-hospitalet -> L'Hospitalet
      out.push(`${w === "l" ? "L" : w}'${capitalize(words[i + 1])}`);
      i += 2;
      continue;
    }
    out.push(PARTICLES.indexOf(w) !== -1 && out.length > 0 ? w : capitalize(w));
    i += 1;
  }
  return out.join(" ");
}

function splitList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function lastSlug(value) {
  if (!value) return "";
  const parts = String(value).trim().replace(/^\/+|\/+$/g, "").split("/");
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------- dates (hora de Barcelona)
const HOUR_MS = 3600000;

function lastSundayOfMonth(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

// Desfasament de Europe/Madrid respecte d'UTC (en hores) a l'instant `utcMs`: 2 a l'estiu, 1 a l'hivern.
function madridOffsetHours(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1); // últim diumenge de març, 01:00 UTC
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1); // últim diumenge d'octubre, 01:00 UTC
  return utcMs >= dstStart && utcMs < dstEnd ? 2 : 1;
}

// Hora local de Barcelona (components) -> instant UTC en ms.
// Hora ambigua (octubre): la primera (estiu). Hora inexistent (març): l'offset d'abans del canvi.
function localToUtcMs(y, mo, d, h, mi, s) {
  const local = Date.UTC(y, mo - 1, d, h, mi, s);
  const summer = local - 2 * HOUR_MS;
  if (madridOffsetHours(summer) === 2) return summer;
  return local - HOUR_MS;
}

// Instant UTC en ms -> components en hora de Barcelona.
function utcToLocalParts(utcMs) {
  const dt = new Date(utcMs + madridOffsetHours(utcMs) * HOUR_MS);
  return {
    y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
    h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds(),
  };
}

// "2026-10-24T22:00:00.000" | "2026-10-24 22:00:00" | "2026-10-24" -> ms UTC (null si no és vàlida).
// Sense zona = hora de Barcelona. Si porta zona explícita (Z, +02:00) es respecta.
function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) && /\d{2}:\d{2}/.test(text)) {
    const abs = Date.parse(text);
    return isNaN(abs) ? null : abs;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC "arrodoneix" dates impossibles (31 de febrer -> març): es descarten
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d ||
      probe.getUTCHours() !== h || probe.getUTCMinutes() !== mi) return null;
  return localToUtcMs(y, mo, d, h, mi, s);
}

// Hora d'inici a partir de `horari` ("A les 18 h", "21.30 h", "20 h Durada: 1 hora").
// Només s'accepta si l'horari COMENÇA amb l'hora: "de 10 a 22 h" (horari d'obertura) no val.
function hourFromSchedule(text) {
  const m = /^\s*(?:a\s+partir\s+de\s+(?:les|la)\s+|a\s+les\s+|a\s+la\s+|a\s+l')?(\d{1,2})(?:[.:](\d{2}))?\s*h\b/i.exec(
    cleanText(text),
  );
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  return hour < 24 ? hour : null;
}

// ---------------------------------------------------------------- preu, ubicació, imatges, url
// 0 = gratuït; null = desconegut. `isFree` és el camp `gratuita` ("Sí"/"No").
function parsePrice(value, isFree) {
  if (typeof isFree === "string" && stripAccents(isFree).trim().toLowerCase() === "si") return 0;
  if (value === null || value === undefined) return null;
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (text.indexOf("gratu") !== -1 || text.indexOf("entrada lliure") !== -1) return 0;
  // Només es fia d'un número acompanyat de moneda: "938 123 456" o "a les 18 h" NO són preus.
  const m = /(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b)/.exec(text) || /€\s*(\d+(?:[.,]\d+)?)/.exec(text);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

function parsePlace(municipalityRaw, comarcaRaw) {
  const one = (raw, table) => {
    const text = raw ? String(raw).trim() : "";
    if (!text) return "";
    if (text.indexOf("agenda:") === -1 && text.indexOf("/") === -1) return text; // text pla: es respecta
    const slug = lastSlug(text);
    return (table && table[slug]) || slugToLabel(slug);
  };
  return [one(municipalityRaw), one(comarcaRaw, COMARQUES)];
}

function parseImages(value) {
  const out = [];
  for (let img of splitList(value)) {
    if (img.startsWith("//")) img = "https:" + img;
    else if (img.startsWith("/")) img = IMAGE_BASE + img;
    // URLs absolutes antigues apunten al host que no serveix
    img = img.replace("://cultura.gencat.cat/", "://agenda.cultura.gencat.cat/");
    if (img.startsWith("http")) out.push(img);
  }
  return out;
}

function tagsFrom(value) {
  const tags = [];
  for (const raw of splitList(value)) {
    const label = raw.indexOf("agenda:") !== -1 || raw.indexOf("/") !== -1 ? slugToLabel(lastSlug(raw)) : raw;
    if (label && tags.indexOf(label) === -1) tags.push(label);
  }
  return tags;
}

// `url` pot dur diverses URLs separades per comes; una és un cercador de l'agenda de la Generalitat,
// que no serveix com a enllaç de l'esdeveniment. Es pren la primera bona.
function pickEventUrl(value) {
  const urls = splitList(value).filter((u) => u.startsWith("http"));
  const good = urls.filter((u) => u.indexOf("agenda.cultura.gencat.cat") === -1);
  return good.length ? good[0] : "";
}

// Decodifica base64url (amb o sense padding) a text UTF-8; llança si no és UTF-8 vàlid.
function base64UrlToUtf8(token) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = [];
  let bits = 0;
  let acc = 0;
  for (const ch of token) {
    const v = alphabet.indexOf(ch);
    if (v === -1) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  return decodeURIComponent(bytes.map((b) => "%" + (b < 16 ? "0" : "") + b.toString(16)).join(""));
}

// Llegeix ambits/categories del paràmetre `c=` (JSON en base64) dels enllaços del cercador de
// l'agenda. Millor esforç: si res no quadra retorna [].
function gencatTaxonomy(value) {
  const out = [];
  for (const url of splitList(value)) {
    const m = /[?&]c=([A-Za-z0-9_-]+)/.exec(url);
    if (!m) continue;
    let data;
    try {
      data = JSON.parse(base64UrlToUtf8(m[1].replace(/_+$/, ""))); // '__' final fa de padding '=='
    } catch (e) {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    for (const key of ["ambits", "categories"]) {
      for (const item of data[key] || []) out.push(lastSlug(item).replace(/-/g, " "));
    }
  }
  return out;
}

// ---------------------------------------------------------------- categorització
function normText(text) {
  const t = stripAccents(text || "").toLowerCase()
    .replace(/·/g, "").replace(/-/g, " ").replace(/'/g, " ").replace(/’/g, " ");
  return " " + t + " ";
}

function compileWords(words) {
  const source = words
    .map((w) => (w.endsWith("$") ? "\\b" + escapeRegExp(w.slice(0, -1)) + "\\b" : "\\b" + escapeRegExp(w)))
    .join("|");
  return { test: new RegExp(source), all: new RegExp(source, "g") };
}

const RX = {};
for (const cat of Object.keys(KEYWORDS)) RX[cat] = compileWords(KEYWORDS[cat]);
const RX_TITLE = {};
for (const cat of Object.keys(TITLE_ONLY)) RX_TITLE[cat] = compileWords(TITLE_ONLY[cat]);

// Retorna les categories (en l'ordre d'EVENT_CATEGORIES) que encaixen.
//   primary   : text fiable (títol, etiquetes, taxonomia de la font): 1 coincidència n'hi ha prou.
//   secondary : text llarg (descripció): calen DESC_MIN_HITS coincidències.
//   startHourLocal: hora d'inici en hora local (null si es desconeix). >= 21h -> "Nit".
function categorize(primary, secondary, startHourLocal) {
  const p = normText(primary);
  const d = normText(secondary);
  const found = new Set();
  for (const cat of Object.keys(RX)) {
    if (RX[cat].test.test(p) || (RX_TITLE[cat] && RX_TITLE[cat].test.test(p))) {
      found.add(cat);
    } else if ((d.match(RX[cat].all) || []).length >= DESC_MIN_HITS) {
      found.add(cat);
    }
  }
  for (const cat of Object.keys(RX_TITLE)) {
    if (!found.has(cat) && RX_TITLE[cat].test.test(p)) found.add(cat);
  }
  if (startHourLocal !== null && startHourLocal !== undefined && startHourLocal >= 21) found.add("Nit");
  return EVENT_CATEGORIES.filter((c) => found.has(c));
}

// ---------------------------------------------------------------- normalització principal
const asUrl = (u) => (u && typeof u === "object" ? u.url : u); // un camp de tipus URL de Socrata arriba com {url: "..."}

// Element cru de Socrata -> { doc } amb la forma del model Event, o { skip: "motiu" }.
function normalizeItem(item) {
  const code = item.codi ? String(item.codi).trim() : "";
  if (!code) return { skip: "sense_codi" };

  const lat = parseFloat(item.latitud);
  const lon = parseFloat(item.longitud);
  if (isNaN(lat) || isNaN(lon)) return { skip: "sense_coordenades" };
  if (lat < 40.0 || lat > 43.5 || lon < 0.0 || lon > 4.0) return { skip: "fora_de_catalunya" };

  const title = cleanText(item.denominaci || "Sense títol");
  if (!title) return { skip: "sense_titol" };

  const startMs = parseDate(item.data_inici);
  if (startMs === null) return { skip: "sense_data_inici" };
  const endParsed = parseDate(item.data_fi);
  let endMs = endParsed === null ? startMs : endParsed;
  if (endMs < startMs || Math.floor((endMs - startMs) / 86400000) > MAX_EVENT_SPAN_DAYS) {
    endMs = startMs; // data de fi absurda (p. ex. any 2924): no es pot confiar-hi
  }
  // La font dóna dates sense hora (00:00). Si no, un esdeveniment d'un sol dia es consideraria
  // acabat des de la mitjanit del mateix dia i la API (endDate >= ara) mai el mostraria.
  const endLocal = utcToLocalParts(endMs);
  if (endLocal.h === 0 && endLocal.mi === 0 && endLocal.s === 0) {
    endMs = localToUtcMs(endLocal.y, endLocal.mo, endLocal.d, 23, 59, 59);
  }

  const [municipality, comarca] = parsePlace(item.municipi, item.comarca);
  const urlRaw = [asUrl(item.url), asUrl(item.enlla_os)].filter(Boolean).join(",");
  const tags = tagsFrom(item.tags_categor_es);
  const startLocal = utcToLocalParts(startMs);
  // L'hora real sol anar a `horari` (text lliure); data_inici gairebé sempre és a les 00:00.
  let hour = hourFromSchedule(item.horari);
  if (hour === null && (startLocal.h || startLocal.mi)) hour = startLocal.h;
  const ambitsText = splitList(item.tags_mbits).map((a) => lastSlug(a).replace(/-/g, " ")).join(" ");
  const description = cleanText(item.descripcio);

  const doc = {
    code,
    title,
    description,
    startDate: new Date(startMs),
    endDate: new Date(endMs),
    schedule: cleanText(item.horari),
    venue: cleanText(item.espai),
    address: cleanText(item.adre_a),
    municipality,
    comarca,
    categories: categorize(
      `${title} ${tags.join(" ")} ${ambitsText} ${gencatTaxonomy(urlRaw).join(" ")}`,
      description,
      hour,
    ),
    tags,
    url: pickEventUrl(urlRaw),
    images: parseImages(item.imatges),
    email: String(item.email || "").trim(),
    phone: cleanText(item.tel_fon),
    source: "ingest",
  };
  if (lat >= LAT_RANGE[0] && lat <= LAT_RANGE[1] && lon >= LNG_RANGE[0] && lon <= LNG_RANGE[1]) {
    doc.location = { type: "Point", coordinates: [lon, lat] }; // GeoJSON: [longitud, latitud]
  }
  const price = parsePrice(item.entrades, item.gratuita);
  if (price !== null) doc.price = price;
  return { doc };
}

// (filtre, update) per a un upsert idempotent per `code`. Imita els timestamps de Mongoose.
function buildOperation(doc, now) {
  const update = {
    $set: Object.assign({}, doc, { updatedAt: now }),
    $setOnInsert: { createdAt: now },
  };
  const unset = {};
  for (const f of OPTIONAL_FIELDS) if (!(f in doc)) unset[f] = "";
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return { updateOne: { filter: { code: doc.code }, update, upsert: true } };
}

// ---------------------------------------------------------------- trigger
exports = async function () {
  let mongodb = context.services.get("Caliu");
  if (!mongodb) {
    mongodb = context.services.get("mongodb-atlas");
  }
  if (!mongodb) {
    throw new Error("No s'ha trobat el servei de base de dades. Revisa Linked Data Sources.");
  }

  const eventsCol = mongodb.db("Caliu").collection("esdeveniments");

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  // Fins al final del dia límit (sense l'hora, els esdeveniments d'aquell dia quedaven fora)
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 86400000).toISOString().split("T")[0] + "T23:59:59";
  // Data de fi màxima raonable (3 anys) per descartar errates com l'any 2924
  const maxEndDate = new Date(now.getTime());
  maxEndDate.setUTCFullYear(now.getUTCFullYear() + 3);
  const maxEnd = maxEndDate.toISOString().split("T")[0];

  const whereFilter = `data_fi>='${today}' and data_fi<='${maxEnd}' and data_inici<='${windowEnd}'`;
  // Ordre determinista (amb desempat per codi) perquè la paginació no repeteixi ni perdi files.
  const order = encodeURIComponent("data_inici ASC, codi ASC");

  const rawItems = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${SOURCE_URL}?$limit=${PAGE_SIZE}&$offset=${page * PAGE_SIZE}&$order=${order}&$where=${encodeURIComponent(whereFilter)}`;
    console.log(`Descarregant esdeveniments (pàgina ${page + 1}): ${url}`);

    const response = await context.http.get({ url });
    if (response.statusCode !== 200) {
      throw new Error(`Error de l'API (${response.statusCode}): ${response.body.text()}`);
    }
    let batch;
    try {
      batch = JSON.parse(response.body.text());
    } catch (err) {
      throw new Error("Error llegint el JSON de l'API.");
    }
    for (const item of batch) rawItems.push(item);
    if (batch.length < PAGE_SIZE) break;
  }

  const skipped = {};
  const bump = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const byCode = new Map();
  for (const item of rawItems) {
    let result;
    try {
      result = normalizeItem(item);
    } catch (err) { // un element estrany no ha de tombar tota la sincronització
      console.log(`Element ${item && item.codi} no processable: ${err}`);
      bump("error_inesperat");
      continue;
    }
    if (result.skip) { bump(result.skip); continue; }
    if (byCode.has(result.doc.code)) bump("codi_duplicat");
    byCode.set(result.doc.code, result.doc); // l'últim guanya
  }

  const docs = Array.from(byCode.values());
  if (docs.length === 0) {
    console.log("No hi ha esdeveniments nous per afegir.");
    return { status: "no_data", llegits: rawItems.length, saltats: skipped };
  }

  let inserted = 0;
  let modified = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const operations = docs.slice(i, i + BATCH_SIZE).map((doc) => buildOperation(doc, now));
    const result = await eventsCol.bulkWrite(operations, { ordered: false });
    inserted += (result && result.upsertedCount) || 0;
    modified += (result && result.modifiedCount) || 0;
  }

  console.log(`Guardat a la DB amb èxit! Llegits: ${rawItems.length}, vàlids: ${docs.length}`);
  return {
    status: "success",
    llegits: rawItems.length,
    esdeveniments_processats: docs.length,
    nous_inserits: inserted,
    actualitzats: modified,
    saltats: skipped,
  };
};
