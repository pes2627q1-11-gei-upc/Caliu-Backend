// Mobilitat sostenible a prop d'un esdeveniment (#226, HU #211): lògica pura sobre les dades de WayGo.
// Abast acordat amb WayGo: només Barcelona. El resum de la fitxa el calcula Caliu (WayGo no el dona).

// Radi que es demana a WayGo (el seu per defecte) i distància del resum («a menys de 500 m»).
export const MOBILITY_RADIUS_METERS = 1500;
export const SUMMARY_WITHIN_METERS = 500;

export const UNAVAILABLE_MOBILITY = Object.freeze({ available: false, summary: null, points: [] });

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const text = (value) => (typeof value === 'string' ? value : '');
// Només enllaços https: res de "javascript:" ni altres esquemes dins d'un botó de l'app.
const httpsUrl = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : '');

// Punt on buscar la mobilitat, o null si l'esdeveniment no és de Barcelona o no té coordenades.
export function mobilityOrigin(event) {
  const [lng, lat] = event?.location?.coordinates ?? [];
  if (fold(event?.municipality) !== 'barcelona' || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lat, lng };
}

// DTO: un punt de WayGo amb els noms de camp de l'API de Caliu. Els tipus desconeguts es descarten.
export function toMobilityPoint(point) {
  const base = {
    type: point?.type,
    name: text(point?.name),
    address: text(point?.address),
    distanceMeters: Math.round(number(point?.distance_meters)),
    mapsUrl: httpsUrl(point?.maps_url),
  };
  if (point?.type === 'bike_station') {
    return {
      ...base,
      system: text(point.system),
      electricBikes: number(point.available_electric_bikes),
      mechanicalBikes: number(point.available_mechanical_bikes),
      freeSlots: number(point.available_slots),
    };
  }
  if (point?.type === 'charging_point') {
    return {
      ...base,
      chargers: number(point.number_of_chargers),
      status: text(point.status),
      speed: text(point.speed_category),
      current: text(point.current_type),
    };
  }
  return null;
}

// Resum per a la fitxa: «N estacions de bici a menys de 500 m · M ancoratges lliures · K carregadors».
export function summarizeMobility(points, withinMeters = SUMMARY_WITHIN_METERS) {
  const near = points.filter((point) => point.distanceMeters <= withinMeters);
  const bikes = near.filter((point) => point.type === 'bike_station');
  return {
    bikeStations: bikes.length,
    freeSlots: bikes.reduce((sum, point) => sum + point.freeSlots, 0),
    chargingPoints: near.filter((point) => point.type === 'charging_point').length,
    withinMeters,
  };
}

// Resposta de GET /events/{id}/mobility a partir dels resultats de WayGo. Sense punts vàlids, no es mostra.
export function buildMobility(results) {
  const points = results.map(toMobilityPoint).filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  if (!points.length) return { ...UNAVAILABLE_MOBILITY, points: [] };
  return { available: true, summary: summarizeMobility(points), points };
}
