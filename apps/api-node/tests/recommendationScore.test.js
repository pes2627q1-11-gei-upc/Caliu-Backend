import mongoose from 'mongoose';
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

describe('#121 tests de l\'algorisme de recomanació', () => {
  const CANDIDATES = [
    ev('concert', { categories: ['Música'], tags: ['Jazz'] }),
    ev('obra', { categories: ['Teatre'], tags: ['Infantil'] }),
    ev('expo', { categories: ['Arts'], tags: ['Fotografia'] }),
  ];
  const first = (options) => rankEvents(CANDIDATES, options)[0].event._id;

  it('dos usuaris amb favorits de categories diferents reben recomanacions diferents (criteri HU #8)', () => {
    const musicFan = [ev('f-jazz', { categories: ['Música'], tags: ['Jazz'] })];
    const theatreFan = [ev('f-titelles', { categories: ['Teatre'], tags: ['Infantil'] })];

    expect(first({ favorites: musicFan })).toBe('concert');
    expect(first({ favorites: theatreFan })).toBe('obra');
  });

  it('dos usuaris amb favorits que només difereixen en les etiquetes també reben recomanacions diferents', () => {
    const candidates = [ev('a', { tags: ['Jazz'] }), ev('b', { tags: ['Rock'] })];
    const rank = (tag) => rankEvents(candidates, { favorites: [ev('f', { tags: [tag] })] })[0].event._id;
    expect(rank('jazz')).toBe('a');
    expect(rank('ROCK')).toBe('b');
  });

  it('exclou els preferits encara que els identificadors siguin ObjectId de consultes diferents', () => {
    const id = new mongoose.Types.ObjectId();
    const favorite = { _id: new mongoose.Types.ObjectId(id.toString()), categories: ['Música'] };
    const candidate = { _id: id, title: 'Ja és preferit', categories: ['Música'], startDate: new Date() };
    const other = { _id: new mongoose.Types.ObjectId(), title: 'Nou', categories: ['Música'], startDate: new Date() };

    const ranked = rankEvents([candidate, other], { favorites: [favorite] });
    expect(ranked.map(({ event }) => event.title)).toEqual(['Nou']);
  });

  it('els pesos configurables canvien l\'ordre de les recomanacions', () => {
    const near = ev('a-prop', { categories: ['Teatre'], distanceMeters: 500 });
    const liked = ev('agradat', { categories: ['Música'], distanceMeters: 9000 });
    const favorites = [ev('f', { categories: ['Música'] })];
    const order = (weights) => rankEvents([near, liked], { favorites, weights, proximitatKm: 10 })
      .map(({ event }) => event._id);

    expect(order({ ...DEFAULT_WEIGHTS, proximity: 10 })).toEqual(['a-prop', 'agradat']);
    expect(order({ ...DEFAULT_WEIGHTS, favoriteCategories: 10 })).toEqual(['agradat', 'a-prop']);
  });

  it('les preferències es comparen sense majúscules ni accents', () => {
    const profile = buildProfile([], ['música', ' TEATRE ']);
    expect(scoreEvent(ev('e', { categories: ['Musica'] }), profile, only('preferences'))).toBe(1);
    expect(scoreEvent(ev('e', { categories: ['Teatre'] }), profile, only('preferences'))).toBe(1);
  });

  it('esdeveniments i favorits sense categories ni etiquetes puntuen 0 sense errors', () => {
    const profile = buildProfile([ev('f'), ev('g', { categories: [], tags: null })], []);
    expect(scoreEvent(ev('e'), profile)).toBe(0);
    expect(scoreEvent(ev('e', { categories: ['Música'], tags: ['Jazz'] }), profile)).toBe(0);
  });

  it('la proximitat val 0 just al límit del radi i amb distàncies no vàlides', () => {
    expect(scoreEvent(ev('e', { distanceMeters: 10000 }), PROFILE, only('proximity'), 10)).toBe(0);
    expect(scoreEvent(ev('e', { distanceMeters: Number.NaN }), PROFILE, only('proximity'), 10)).toBe(0);
    expect(scoreEvent(ev('e', { distanceMeters: '500' }), PROFILE, only('proximity'), 10)).toBe(0);
  });

  it('un esdeveniment sense data d\'inici no trenca l\'ordre i queda primer a igual puntuació', () => {
    const ranked = rankEvents([ev('amb-data'), { _id: 'sense-data', title: 'Sense data' }]);
    expect(ranked.map(({ event }) => event._id)).toEqual(['sense-data', 'amb-data']);
  });

  it('un usuari sense historial ni preferències rep els candidats per proximitat i després per data', () => {
    const ranked = rankEvents([
      ev('lluny', { distanceMeters: 8000 }),
      ev('prop', { distanceMeters: 1000 }),
      ev('sense-ubicacio'),
    ], { proximitatKm: 10 });
    expect(ranked.map(({ event }) => event._id)).toEqual(['prop', 'lluny', 'sense-ubicacio']);
  });
});
