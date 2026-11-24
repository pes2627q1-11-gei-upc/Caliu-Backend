import Interaction from '../models/Interaction.js';
import { loadRecommenderWeights } from '../models/RecommenderConfig.js';
import { DEFAULT_WEIGHTS } from '../domain/recommenderWeights.js';
import { parseEventQuery, QueryError } from '../domain/eventQuery.js';
import { activityRadiusKm, rankEvents } from '../domain/recommendationScore.js';
import { findEvents, toApi } from './events.controller.js';

const ALLOWED_PARAMS = ['lat', 'lng', 'page', 'limit'];
// Candidats que es puntuen com a màxim: els més propers (amb ubicació) o els pròxims per data.
export const MAX_CANDIDATES = 200;

// Paràmetres de GET /recommendations (#120): ubicació opcional (lat i lng) i paginació. El radi no és un
// paràmetre: és el radi d'activitat de l'usuari (proximitatKm, #123). La validació és la de GET /events.
function parseRecommendationQuery(query, proximitatKm) {
  const unknown = Object.keys(query).filter((key) => !ALLOWED_PARAMS.includes(key));
  if (unknown.length) throw new QueryError(`Paràmetre no admès: ${unknown.join(', ')}`);
  const withRadius = query.lat !== undefined ? { ...query, radiusKm: activityRadiusKm(proximitatKm) } : query;
  return parseEventQuery(withRadius);
}

// Esdeveniments preferits de l'usuari (només les dades que fa servir l'algorisme).
async function favoriteEvents(userId) {
  const interactions = await Interaction.find({ userId, type: 'favorite' })
    .populate('eventId', 'categories tags')
    .lean();
  return interactions.map(({ eventId }) => eventId).filter(Boolean);
}

// Si no es poden llegir els pesos, es recomana amb els per defecte. L'error no es mostra perquè pot
// contenir la URI de la base de dades.
async function weightsOrDefaults() {
  try {
    return await loadRecommenderWeights();
  } catch {
    console.error('No s’han pogut llegir els pesos del recomanador; es fan servir els per defecte');
    return { ...DEFAULT_WEIGHTS };
  }
}

// GET /recommendations (#120, HU #8): esdeveniments recomanats per a l'usuari autenticat, ordenats per
// puntuació (#119). Un usuari sense historial rep els propers (amb ubicació) o els pròxims per data.
// Reajust en marcar un preferit (#158, HU #46): el perfil de gustos es calcula a cada petició a partir dels
// preferits actuals, així que afegir-ne o treure'n un es reflecteix a la petició següent, sense guardar ni
// invalidar res. La ruta respon amb Cache-Control: no-store perquè cap client en reutilitzi una de vella.
export async function getRecommendations(req, res, next) {
  try {
    const parsed = parseRecommendationQuery(req.query, req.user.proximitatKm);
    const [favorites, weights, candidates] = await Promise.all([
      favoriteEvents(req.user._id),
      weightsOrDefaults(),
      findEvents({ ...parsed, limit: MAX_CANDIDATES, skip: 0 }),
    ]);
    const ranked = rankEvents(candidates.items, {
      favorites,
      preferences: req.user.preferences,
      weights,
      proximitatKm: req.user.proximitatKm,
    });
    const items = ranked.slice(parsed.skip, parsed.skip + parsed.limit)
      .map(({ event, score }) => ({ ...toApi(event), score: Math.round(score * 100) / 100 }));
    res.json({ items, page: parsed.page, limit: parsed.limit, total: ranked.length });
  } catch (err) {
    next(err);
  }
}
