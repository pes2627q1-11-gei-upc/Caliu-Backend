import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Interaction from '../src/models/Interaction.js';
import RecommenderConfig from '../src/models/RecommenderConfig.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';

// Es simula el model Event perquè els tests no necessiten MongoDB.
const find = jest.fn();
const countDocuments = jest.fn();
const aggregate = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({
  default: { find, countDocuments, aggregate, findById: jest.fn() },
}));

const { default: app } = await import('../src/app.js');

const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const USER_ID = '64b7f0c2a1b2c3d4e5f60721';
const lean = (value) => ({ lean: () => value });

const ev = (id, fields = {}) => ({
  _id: id, __v: 0, title: id, startDate: new Date('2026-11-28T10:00:00Z'), endDate: new Date('2026-11-28T12:00:00Z'),
  categories: [], tags: [], ...fields,
});
const JAZZ = ev('64b7f0c2a1b2c3d4e5f60731', { categories: ['Música'], tags: ['Jazz'] });
const THEATRE = ev('64b7f0c2a1b2c3d4e5f60732', { categories: ['Teatre'] });
const ART = ev('64b7f0c2a1b2c3d4e5f60733', { categories: ['Arts'], startDate: new Date('2026-11-27T10:00:00Z') });
const FAVORITE = ev('64b7f0c2a1b2c3d4e5f60734', { categories: ['Música'], tags: ['Jazz'] });

// Event.find(...).sort(...).skip(...).limit(...).lean()
let limitUsed;
const chain = (items) => {
  const q = { sort: () => q, skip: () => q, limit: (n) => { limitUsed = n; return q; }, lean: () => Promise.resolve(items) };
  return q;
};

let token;
let user;
let favorites;
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  token = jwt.sign({ jti: 'a'.repeat(64) }, SECRET, {
    subject: USER_ID, algorithm: 'HS256', issuer: 'caliu-api', audience: 'caliu-android', expiresIn: 3600,
  });
  user = { _id: USER_ID, preferences: [], proximitatKm: 5 };
  favorites = [{ eventId: FAVORITE }];
  find.mockReset();
  countDocuments.mockReset().mockResolvedValue(0);
  aggregate.mockReset();
  limitUsed = undefined;
  jest.spyOn(User, 'findById').mockImplementation(() => lean(Promise.resolve(user)));
  jest.spyOn(Session, 'exists').mockResolvedValue({ _id: 'session' });
  jest.spyOn(Interaction, 'find').mockImplementation(() => ({ populate: () => lean(Promise.resolve(favorites)) }));
  jest.spyOn(RecommenderConfig, 'findById').mockReturnValue(lean(Promise.resolve(null)));
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const get = (query = {}) => request(app).get('/recommendations').query(query).auth(token, { type: 'bearer' });
const ids = (res) => res.body.items.map((item) => item.id);

describe('#120 GET /recommendations', () => {
  it('exigeix JWT i no consulta res sense sessió', async () => {
    const res = await request(app).get('/recommendations');
    expect(res.status).toBe(401);
    expect(find).not.toHaveBeenCalled();
    expect(Interaction.find).not.toHaveBeenCalled();
  });

  it('ordena segons els preferits i les preferències de l\'usuari i exclou el preferit', async () => {
    user.preferences = ['Teatre'];
    find.mockReturnValue(chain([ART, THEATRE, JAZZ, FAVORITE]));

    const res = await get();

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([JAZZ._id, THEATRE._id, ART._id]);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
    expect(res.body.items[0]).toMatchObject({ id: JAZZ._id, title: JAZZ.title, score: 4 });
    expect(res.body.items[0]).not.toHaveProperty('_id');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Interaction.find).toHaveBeenCalledWith({ userId: USER_ID, type: 'favorite' });
  });

  it.each([[5, 5000], [null, 10000], [undefined, 10000]])(
    'amb ubicació busca dins del radi d\'activitat de l\'usuari (%p km)',
    async (proximitatKm, meters) => {
      user.proximitatKm = proximitatKm;
      aggregate.mockResolvedValue([{ items: [{ ...THEATRE, distanceMeters: 1000 }], total: [{ n: 1 }] }]);

      const res = await get({ lat: 41.98, lng: 2.82 });

      expect(res.status).toBe(200);
      const [pipeline] = aggregate.mock.calls[0];
      expect(pipeline[0].$geoNear).toMatchObject({ near: { type: 'Point', coordinates: [2.82, 41.98] }, maxDistance: meters });
      expect(pipeline[1].$facet.items).toContainEqual({ $limit: 200 });
      expect(res.body.items[0]).toMatchObject({ id: THEATRE._id, distanceMeters: 1000 });
      expect(find).not.toHaveBeenCalled();
    },
  );

  it('sense ubicació fa servir els pròxims esdeveniments per data, com a màxim 200', async () => {
    find.mockReturnValue(chain([THEATRE]));
    await get();
    expect(find.mock.calls[0][0]).toHaveProperty('endDate.$gte');
    expect(limitUsed).toBe(200);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('un usuari sense historial ni preferències rep la llista per defecte, per data', async () => {
    favorites = [];
    find.mockReturnValue(chain([THEATRE, ART]));

    const res = await get();

    expect(ids(res)).toEqual([ART._id, THEATRE._id]);
    expect(res.body.items.map((item) => item.score)).toEqual([0, 0]);
  });

  it('si no es poden llegir els pesos, recomana amb els per defecte i ho deixa als logs', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    RecommenderConfig.findById.mockReturnValue({ lean: () => Promise.reject(new Error('mongodb://usuari:clau@host')) });
    find.mockReturnValue(chain([THEATRE, JAZZ]));

    const res = await get();

    expect(res.status).toBe(200);
    expect(ids(res)[0]).toBe(JAZZ._id);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('es fan servir els per defecte'));
    expect(logged.mock.calls.flat().join(' ')).not.toContain('mongodb://');
  });

  it('pagina després d\'ordenar', async () => {
    find.mockReturnValue(chain([ART, THEATRE, JAZZ]));
    const res = await get({ page: 2, limit: 1 });
    expect(res.body).toMatchObject({ page: 2, limit: 1, total: 3 });
    expect(ids(res)).toEqual([ART._id]);
  });

  it.each([{ radiusKm: 5 }, { category: 'Música' }, { lat: 41.98 }, { lng: 2.82 }, { lat: 'x', lng: 2.82 },
    { lat: 41.98, lng: 200 }, { limit: 0 }, { page: -1 }])('rebutja amb 400 la consulta %p', async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(find).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });
});
