// Client del servei de mobilitat de WayGo (#226, HU #211): estacions de Bicing/AMBici i punts de recàrrega
// propers a un punt. La clau és de Caliu i només viu al servidor (WAYGO_API_KEY): mai arriba a l'app.
// Si no està configurat o WayGo falla, retorna null i la fitxa es mostra sense la secció.

const PATH = '/api/external/nearby-mobility/';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

// Temps màxim curt: la fitxa no ha d'esperar WayGo.
function timeoutMs() {
  const value = Number(process.env.WAYGO_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS ? value : DEFAULT_TIMEOUT_MS;
}

export function isWayGoConfigured() {
  return Boolean(process.env.WAYGO_API_URL?.trim() && process.env.WAYGO_API_KEY?.trim());
}

// Punts de mobilitat (format de WayGo) a menys de `radiusMeters` de (lat, lng), o null si no n'hi ha.
// Els avisos dels logs no inclouen ni la clau ni la URL.
export async function fetchNearbyMobility({ lat, lng, radiusMeters }) {
  if (!isWayGoConfigured()) return null;

  let url;
  try {
    url = new URL(PATH, process.env.WAYGO_API_URL.trim());
  } catch {
    console.error('WAYGO_API_URL no vàlida: no es mostra la mobilitat');
    return null;
  }
  // WayGo fa servir "lon" (no "lng") i el radi en metres.
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lng), radius: String(radiusMeters) }).toString();

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-API-Key': process.env.WAYGO_API_KEY.trim() },
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!response.ok) {
      console.error(`WayGo ha respost ${response.status}: no es mostra la mobilitat`);
      return null;
    }
    const body = await response.json();
    if (!Array.isArray(body?.results)) {
      console.error('Resposta de WayGo no vàlida: no es mostra la mobilitat');
      return null;
    }
    return body.results;
  } catch (err) {
    console.error(err?.name === 'TimeoutError'
      ? 'WayGo ha tardat massa a respondre: no es mostra la mobilitat'
      : 'No s’ha pogut contactar amb WayGo: no es mostra la mobilitat');
    return null;
  }
}
