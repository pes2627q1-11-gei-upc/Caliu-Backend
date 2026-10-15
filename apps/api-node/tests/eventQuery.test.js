import { parseEventQuery, QueryError } from '../src/domain/eventQuery.js';

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
