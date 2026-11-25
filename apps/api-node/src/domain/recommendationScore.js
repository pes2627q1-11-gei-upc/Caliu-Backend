import { DEFAULT_NEARBY_RADIUS_KM } from './eventQuery.js';
import { DEFAULT_WEIGHTS } from './recommenderWeights.js';

// Algorisme de recomanació (#119, HU #8): puntua els esdeveniments candidats segons els favorits,
// les preferències i la proximitat de l'usuari, amb els pesos configurables (#126):
//
//   puntuació = favoriteCategories × part dels favorits que comparteixen alguna categoria
//             + favoriteTags       × part dels favorits que comparteixen alguna etiqueta
//             + preferences        × (1 si alguna categoria és de les preferències, 0 si no)
//             + proximity          × (1 − distància / radi; 0 fora del radi o sense distància)
//
// Cada terme va de 0 a 1. És lògica pura (no toca la base de dades): rep les dades ja carregades.

// Sense accents, espais ni majúscules: "Música" i "musica" compten igual (com la cerca).
const normalize = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const toSet = (values) => new Set((values ?? []).map(normalize).filter(Boolean));

// Radi d'activitat de l'usuari (#123). Si proximitatKm és null o no existeix, el mateix radi per
// defecte que GET /events/nearby.
export function activityRadiusKm(proximitatKm) {
  return typeof proximitatKm === 'number' && proximitatKm > 0 ? proximitatKm : DEFAULT_NEARBY_RADIUS_KM;
}

// Perfil de gustos: categories i etiquetes de cada esdeveniment preferit, i les preferències.
export function buildProfile(favorites = [], preferences = []) {
  return {
    favorites: favorites.map((event) => ({ categories: toSet(event.categories), tags: toSet(event.tags) })),
    preferences: toSet(preferences),
  };
}

// Part dels favorits (de 0 a 1) que comparteixen alguna categoria o etiqueta (`key`) amb l'esdeveniment.
function favoriteShare(profile, values, key) {
  const own = toSet(values);
  if (!profile.favorites.length || !own.size) return 0;
  const matches = profile.favorites.filter((favorite) => [...favorite[key]].some((value) => own.has(value)));
  return matches.length / profile.favorites.length;
}

// 1 a la mateixa ubicació, 0 a la vora del radi o més enllà. distanceMeters el calcula $geoNear.
function proximityScore(distanceMeters, radiusKm) {
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters)) return 0;
  return Math.max(0, 1 - distanceMeters / (radiusKm * 1000));
}

export function scoreEvent(event, profile, weights = DEFAULT_WEIGHTS, radiusKm = DEFAULT_NEARBY_RADIUS_KM) {
  const terms = {
    favoriteCategories: favoriteShare(profile, event.categories, 'categories'),
    favoriteTags: favoriteShare(profile, event.tags, 'tags'),
    preferences: [...toSet(event.categories)].some((category) => profile.preferences.has(category)) ? 1 : 0,
    proximity: proximityScore(event.distanceMeters, radiusKm),
  };
  return Object.entries(terms).reduce((sum, [key, value]) => sum + weights[key] * value, 0);
}

const startTime = (event) => new Date(event.startDate).getTime() || 0;

// Recomanacions: exclou els esdeveniments que ja són preferits, puntua la resta i els ordena per
// puntuació. A igualtat, primer el que comença abans i després per identificador (ordre estable).
export function rankEvents(events, { favorites = [], preferences = [], weights = DEFAULT_WEIGHTS, proximitatKm } = {}) {
  const profile = buildProfile(favorites, preferences);
  const radiusKm = activityRadiusKm(proximitatKm);
  const favoriteIds = new Set(favorites.map((event) => String(event._id)));
  return events
    .filter((event) => !favoriteIds.has(String(event._id)))
    .map((event) => ({ event, score: scoreEvent(event, profile, weights, radiusKm) }))
    .sort((a, b) => b.score - a.score
      || startTime(a.event) - startTime(b.event)
      || String(a.event._id).localeCompare(String(b.event._id)));
}
