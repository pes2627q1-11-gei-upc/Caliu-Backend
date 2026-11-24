import { DEFAULT_WEIGHTS } from '../src/domain/recommenderWeights.js';
import {
  activityRadiusKm, buildProfile, rankEvents, scoreEvent,
} from '../src/domain/recommendationScore.js';

// Pesos que només activen un terme: la puntuació és exactament el valor d'aquell terme (0..1).
const only = (key) => ({ favoriteCategories: 0, favoriteTags: 0, preferences: 0, proximity: 0, [key]: 1 });

const ev = (id, fields = {}) => ({ _id: id, title: id, startDate: new Date('2026-11-21T10:00:00Z'), ...fields });

const FAVORITES = [
  ev('f1', { categories: ['Música'], tags: ['Jazz', 'En directe'] }),
  ev('f2', { categories: ['Música'], tags: ['Rock'] }),
  ev('f3', { categories: ['Música', 'Nit'], tags: ['Jazz'] }),
  ev('f4', { categories: ['Teatre'], tags: ['Infantil'] }),
];
const PROFILE = buildProfile(FAVORITES, ['Arts']);

describe('#119 algorisme de scoring', () => {
  it('fa servir proximitatKm com a radi, o 10 km si és null o no existeix', () => {
    expect(activityRadiusKm(12.5)).toBe(12.5);
    expect([null, undefined, 0, '5'].map(activityRadiusKm)).toEqual([10, 10, 10, 10]);
  });

  it('categories dels favorits: part dels favorits que comparteixen alguna categoria', () => {
    expect(scoreEvent(ev('e', { categories: ['Música'] }), PROFILE, only('favoriteCategories'))).toBe(0.75);
    expect(scoreEvent(ev('e', { categories: ['Teatre'] }), PROFILE, only('favoriteCategories'))).toBe(0.25);
    expect(scoreEvent(ev('e', { categories: ['Esports'] }), PROFILE, only('favoriteCategories'))).toBe(0);
  });

  it('etiquetes dels favorits, sense distingir majúscules ni accents', () => {
    expect(scoreEvent(ev('e', { tags: ['jazz'] }), PROFILE, only('favoriteTags'))).toBe(0.5);
    expect(scoreEvent(ev('e', { tags: ['EN DIRECTE', 'rock'] }), PROFILE, only('favoriteTags'))).toBe(0.5);
    expect(scoreEvent(ev('e', { tags: ['infantìl'] }), PROFILE, only('favoriteTags'))).toBe(0.25);
  });

  it('preferències: 1 si alguna categoria és de les preferències, 0 si no', () => {
    expect(scoreEvent(ev('e', { categories: ['Música', 'arts'] }), PROFILE, only('preferences'))).toBe(1);
    expect(scoreEvent(ev('e', { categories: ['Música'] }), PROFILE, only('preferences'))).toBe(0);
  });

  it('proximitat: 1 − distància/radi dins del radi, 0 fora o sense distància', () => {
    expect(scoreEvent(ev('e', { distanceMeters: 2500 }), PROFILE, only('proximity'), 10)).toBe(0.75);
    expect(scoreEvent(ev('e', { distanceMeters: 0 }), PROFILE, only('proximity'), 10)).toBe(1);
    expect(scoreEvent(ev('e', { distanceMeters: 12000 }), PROFILE, only('proximity'), 10)).toBe(0);
    expect(scoreEvent(ev('e'), PROFILE, only('proximity'), 10)).toBe(0);
  });

  it('sense favorits ni preferències, només hi compta la proximitat', () => {
    const empty = buildProfile();
    const event = ev('e', { categories: ['Música'], tags: ['Jazz'], distanceMeters: 5000 });
    expect(scoreEvent(event, empty)).toBe(DEFAULT_WEIGHTS.proximity * 0.5);
    expect(scoreEvent(ev('e', { categories: ['Música'] }), empty)).toBe(0);
  });

  it('combina els quatre termes amb els pesos', () => {
    const event = ev('e', { categories: ['Música', 'Arts'], tags: ['Jazz'], distanceMeters: 5000 });
    // 3 × 0.75 (categories) + 1 × 0.5 (etiquetes) + 2 × 1 (preferències) + 2 × 0.5 (proximitat)
    expect(scoreEvent(event, PROFILE, DEFAULT_WEIGHTS, 10)).toBeCloseTo(5.75);
  });

  it('exclou els preferits i ordena per puntuació, hora d\'inici i identificador', () => {
    const later = new Date('2026-11-21T18:00:00Z');
    const events = [
      ev('teatre', { categories: ['Teatre'] }),
      ev('jazz', { categories: ['Música'], tags: ['Jazz'] }),
      ev('res-tard', { startDate: later }),
      ev('res-b'),
      ev('res-a'),
      FAVORITES[0],
    ];
    const ranked = rankEvents(events, { favorites: FAVORITES, preferences: ['Arts'], proximitatKm: null });
    expect(ranked.map(({ event }) => event._id)).toEqual(['jazz', 'teatre', 'res-a', 'res-b', 'res-tard']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('sense opcions retorna els candidats sense puntuació, per data', () => {
    expect(rankEvents([ev('b'), ev('a')]).map(({ event, score }) => [event._id, score])).toEqual([['a', 0], ['b', 0]]);
  });
});
