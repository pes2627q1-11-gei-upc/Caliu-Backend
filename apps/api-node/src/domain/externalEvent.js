import { parseEventQuery, QueryError } from './eventQuery.js';

const EXTERNAL_PARAMS = ['from', 'to', 'comarca', 'lat', 'lng', 'radiusKm', 'page', 'limit'];

// Paràmetres de GET /ext/v1/events (#214), segons el contracte amb Xematrip: un rang de dates
// i UNA zona (una sola comarca, o bé un radi al voltant d'un punt), amb paginació. Qualsevol
// altre paràmetre es rebutja. La validació de dates, números i paginació és la de parseEventQuery.
// Fora de l'entorn de desenvolupament s'amaguen les dades de prova, com fa el xat (rag.py).
export function parseExternalEventQuery(query = {}, now = new Date(), appEnv = process.env.APP_ENV) {
  const unknown = Object.keys(query).filter((key) => !EXTERNAL_PARAMS.includes(key));
  if (unknown.length) throw new QueryError(`Paràmetre no admès: ${unknown.join(', ')}`);

  const byRadius = ['lat', 'lng', 'radiusKm'].some((key) => query[key] !== undefined);
  const byComarca = query.comarca !== undefined;
  if (byRadius === byComarca) {
    throw new QueryError('Cal indicar una sola zona: "comarca", o bé "lat", "lng" i "radiusKm"');
  }
  if (byRadius && ['lat', 'lng', 'radiusKm'].some((key) => query[key] === undefined)) {
    throw new QueryError('La zona per radi requereix "lat", "lng" i "radiusKm"');
  }
  if (byComarca) {
    // Una buida o diverses (Gironès,Selva o ?comarca=a&comarca=b) no compleixen el contracte.
    const comarques = Array.isArray(query.comarca) ? query.comarca : String(query.comarca).split(',');
    if (comarques.map((value) => String(value).trim()).filter(Boolean).length !== 1) {
      throw new QueryError('Paràmetre "comarca" invàlid (ha de ser una sola comarca, no buida)');
    }
  }

  const parsed = parseEventQuery(query, now);
  if (String(appEnv ?? '').trim().toLowerCase() !== 'development') {
    parsed.filter.source = { $ne: 'seed' };
  }
  return parsed;
}

// DTO dels esdeveniments per als clients externs (#213), segons el contracte amb Xematrip:
// només títol, dates, horari, ubicació (adreça, municipi, comarca i coordenades), etiquetes
// i enllaç oficial. Llista explícita: no surt la descripció, categories, preu, imatges,
// contacte ni cap camp intern.
//
// És lògica pura (no toca la base de dades): viu a domain/ i no a models/Event.js perquè
// diversos tests substitueixen aquell mòdul sencer per un model simulat.
export function externalEvent(event) {
  return {
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate ?? null,
    schedule: event.schedule ?? '',
    location: {
      address: event.address ?? '',
      municipality: event.municipality ?? '',
      comarca: event.comarca ?? '',
      coordinates: event.location?.coordinates ? [...event.location.coordinates] : null, // [lng, lat]
    },
    tags: [...(event.tags ?? [])],
    url: event.url ?? '',
  };
}
