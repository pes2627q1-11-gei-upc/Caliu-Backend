import {
  accentInsensitiveRegex,
  parseEventQuery,
  parseSearchQuery,
  QueryError,
} from '../src/domain/eventQuery.js';

const NOW = new Date('2026-10-15T10:00:00Z');

describe('parseEventQuery', () => {
  it('per defecte mostra només els events que no han acabat, pàgina 1 i límit 20', () => {
    const r = parseEventQuery({}, NOW);
    expect(r.filter.endDate.$gte).toEqual(NOW);
    expect(r.geo).toBeNull();
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
    expect(r.skip).toBe(0);
  });

  it('accepta categories separades per comes', () => {
    const r = parseEventQuery({ category: 'Música,Teatre' }, NOW);
    expect(r.filter.categories).toEqual({ $in: ['Música', 'Teatre'] });
  });

  it('calcula el filtre de proximitat en metres', () => {
    const r = parseEventQuery({ lat: '41.38', lng: '2.17', radiusKm: '5' }, NOW);
    expect(r.geo).toEqual({ lat: 41.38, lng: 2.17, maxDistance: 5000 });
  });

  it('rebutja lat sense lng', () => {
    expect(() => parseEventQuery({ lat: '41.38' }, NOW)).toThrow(QueryError);
  });

  it('rebutja radiusKm sense coordenades', () => {
    expect(() => parseEventQuery({ radiusKm: '5' }, NOW)).toThrow(QueryError);
  });

  it('rebutja dates invàlides i rangs invertits', () => {
    expect(() => parseEventQuery({ from: 'xxx' }, NOW)).toThrow(QueryError);
    expect(() =>
      parseEventQuery({ from: '2026-10-20T00:00:00Z', to: '2026-10-19T00:00:00Z' }, NOW),
    ).toThrow(QueryError);
  });

  it('escapa els caràcters especials de la cerca de text', () => {
    const r = parseEventQuery({ q: 'a.b' }, NOW);
    const rx = r.filter.$or[0].title;
    expect(rx.test('a.b')).toBe(true);
    expect(rx.test('axb')).toBe(false);
  });

  it('limita el límit màxim a 100 i calcula el skip', () => {
    const r = parseEventQuery({ limit: '500', page: '3' }, NOW);
    expect(r.limit).toBe(100);
    expect(r.skip).toBe(200);
  });
});

describe('accentInsensitiveRegex', () => {
  it('ignora majúscules i accents en ambdós sentits', () => {
    expect(accentInsensitiveRegex('musica').test('Música clàssica')).toBe(true);
    expect(accentInsensitiveRegex('MÚSICA').test('musica')).toBe(true);
    expect(accentInsensitiveRegex('classica').test('Música clàssica')).toBe(true);
    expect(accentInsensitiveRegex('clàssica').test('classica')).toBe(true);
    expect(accentInsensitiveRegex('comedia').test('Comèdia')).toBe(true);
    expect(accentInsensitiveRegex('mercat').test('Mercat de Mercè')).toBe(true);
  });

  it('tracta la ç i la ñ com a c i n', () => {
    expect(accentInsensitiveRegex('mercè').test('Mercè')).toBe(true);
    expect(accentInsensitiveRegex('merce').test('Mercè')).toBe(true);
    expect(accentInsensitiveRegex('cancion').test('Canción')).toBe(true);
    expect(accentInsensitiveRegex('espana').test('España')).toBe(true);
    expect(accentInsensitiveRegex('Terrassa').test('Tèrrassa')).toBe(true);
  });

  it('cerca coincidències parcials però no inventa lletres', () => {
    expect(accentInsensitiveRegex('conc').test('Concert de jazz')).toBe(true);
    expect(accentInsensitiveRegex('jazz').test('Concert de música')).toBe(false);
  });

  it('escapa els caràcters especials: mai s\'interpreten com a regex', () => {
    const rx = accentInsensitiveRegex('a.b');
    expect(rx.test('a.b')).toBe(true);
    expect(rx.test('axb')).toBe(false);
    expect(() => accentInsensitiveRegex('(((')).not.toThrow();
    expect(accentInsensitiveRegex('c++').test('Curs de C++')).toBe(true);
    expect(accentInsensitiveRegex('\\d').test('a\\d')).toBe(true);
    expect(accentInsensitiveRegex('\\d').test('5')).toBe(false);
  });
});

describe('parseSearchQuery', () => {
  const matches = (filter, doc) =>
    filter.$and.every((cond) =>
      cond.$or.some((c) => {
        const [field, rx] = Object.entries(c)[0];
        const value = doc[field];
        return Array.isArray(value) ? value.some((v) => rx.test(v)) : rx.test(value ?? '');
      }),
    );

  it('exigeix q (absent, buit o només espais)', () => {
    expect(() => parseSearchQuery({}, NOW)).toThrow(QueryError);
    expect(() => parseSearchQuery({ q: '' }, NOW)).toThrow(QueryError);
    expect(() => parseSearchQuery({ q: '   ' }, NOW)).toThrow(QueryError);
    expect(() => parseSearchQuery({ q: { a: 'b' } }, NOW)).toThrow(QueryError);
  });

  it('rebutja un q massa llarg', () => {
    expect(() => parseSearchQuery({ q: 'a'.repeat(101) }, NOW)).toThrow(QueryError);
    expect(() => parseSearchQuery({ q: 'a'.repeat(100) }, NOW)).not.toThrow();
  });

  it('cerca només al títol i a les etiquetes (no a lloc ni municipi)', () => {
    const { filter } = parseSearchQuery({ q: 'jazz' }, NOW);
    const fields = filter.$and.flatMap((c) => c.$or.flatMap((x) => Object.keys(x)));
    expect(new Set(fields)).toEqual(new Set(['title', 'tags']));
    expect(filter.$or).toBeUndefined(); // el $or de GET /events (amb venue i municipality) no s'hi barreja
  });

  it('troba per títol o per etiqueta, sense accents ni majúscules', () => {
    const { filter } = parseSearchQuery({ q: 'musica' }, NOW);
    expect(matches(filter, { title: 'Festival de Música', tags: [] })).toBe(true);
    expect(matches(filter, { title: 'Nit de festa', tags: ['Música clàssica'] })).toBe(true);
    expect(matches(filter, { title: 'Nit de festa', tags: ['Teatre'] })).toBe(false);
  });

  it('cada paraula ha de coincidir (en qualsevol ordre, entre títol i etiquetes)', () => {
    const { filter } = parseSearchQuery({ q: '  infantil   teatre ' }, NOW);
    expect(filter.$and).toHaveLength(2);
    expect(matches(filter, { title: '30 elefants sota un paraigua', tags: ['Teatre', 'Infantil'] })).toBe(true);
    expect(matches(filter, { title: 'Teatre grec', tags: ['Arts'] })).toBe(false);
  });

  it('limita el nombre de paraules', () => {
    const { filter } = parseSearchQuery({ q: 'a b c d e f g h i j' }, NOW);
    expect(filter.$and).toHaveLength(8);
  });

  it('accepta q repetit (?q=a&q=b) i el tracta com a dues paraules', () => {
    expect(parseSearchQuery({ q: ['jazz', 'barcelona'] }, NOW).filter.$and).toHaveLength(2);
  });

  it('manté els filtres, la paginació i el "no han acabat" de GET /events', () => {
    const r = parseSearchQuery({ q: 'jazz', category: 'Música', page: '2', limit: '10', lat: '41.38', lng: '2.17' }, NOW);
    expect(r.filter.endDate.$gte).toEqual(NOW);
    expect(r.filter.categories).toEqual({ $in: ['Música'] });
    expect(r.geo).toEqual({ lat: 41.38, lng: 2.17, maxDistance: null });
    expect(r.page).toBe(2);
    expect(r.limit).toBe(10);
    expect(r.skip).toBe(10);
    expect(r.q).toBe('jazz');
  });
});
