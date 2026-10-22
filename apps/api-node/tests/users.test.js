import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';
import { EVENT_CATEGORIES } from '../src/domain/eventCategories.js';
import app from '../src/app.js';

const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const ID = '64b7f0c2a1b2c3d4e5f60718';
const OTHER_ID = '64b7f0c2a1b2c3d4e5f60719';
const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;
let users;
let accessToken;
const clone = (value) => value && structuredClone(value);
function sign(id = ID) {
  return jwt.sign({ tokenVersion: users[id].tokenVersion }, SECRET, {
    subject: id, algorithm: 'HS256', issuer: 'caliu-api', audience: 'caliu-android', expiresIn: 3600,
  });
}
const auth = (req, value = accessToken) => req.auth(value, { type: 'bearer' });

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_TTL_SECONDS = '3600';
  users = Object.fromEntries([ID, OTHER_ID].map((id, index) => [id, {
    _id: id, email: `prova${index}@example.cat`, username: null, preferences: [], tokenVersion: 0,
    passwordHash: 'private-hash', role: 'internal', __v: 2,
  }]));
  accessToken = sign();
  jest.spyOn(User, 'findById').mockImplementation((id) => ({
    select: () => ({ lean: async () => clone(users[id]) }),
  }));
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation(async (filter, update) => {
    const user = users[filter._id];
    if (!user || user.tokenVersion !== filter.tokenVersion) return null;
    Object.assign(user, update.$set);
    return clone(user);
  });
  jest.spyOn(User, 'updateOne').mockImplementation(async (filter, update) => {
    const user = users[filter._id];
    if (!user || user.tokenVersion !== filter.tokenVersion) return { matchedCount: 0 };
    user.tokenVersion += update.$inc.tokenVersion;
    return { matchedCount: 1 };
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTtl === undefined) delete process.env.JWT_TTL_SECONDS;
  else process.env.JWT_TTL_SECONDS = originalTtl;
});

describe('#34 perfil propi', () => {
  it('retorna només camps públics del subject del token', async () => {
    const res = await auth(request(app).get(`/users/me?userId=${OTHER_ID}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: ID, email: users[ID].email, username: null, preferences: [] });
    expect(User.findById).toHaveBeenCalledWith(ID);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('actualitza i persisteix només el username propi', async () => {
    const other = clone(users[OTHER_ID]);
    const res = await auth(request(app).patch('/users/me').send({ username: '  Núria_42  ' }));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('Núria_42');
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: ID, tokenVersion: 0 }, { $set: { username: 'Núria_42' } }, { new: true, runValidators: true },
    );
    expect((await auth(request(app).get('/users/me'))).body.username).toBe('Núria_42');
    expect(users[OTHER_ID]).toEqual(other);
  });

  it('permet noms visibles repetits provisionalment', async () => {
    expect((await auth(request(app).patch('/users/me').send({ username: 'compartit' }))).status).toBe(200);
    expect((await auth(request(app).patch('/users/me').send({ username: 'compartit' }), sign(OTHER_ID))).status).toBe(200);
  });

  it.each(['email', 'password', 'passwordHash', 'role', 'tokenVersion', '_id', 'id', 'userId', 'preferences', '__v', '$set'])('rebutja mass assignment de %s', async (key) => {
    const before = clone(users);
    const res = await auth(request(app).patch('/users/me').send({ username: 'correcte', [key]: OTHER_ID }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(users).toEqual(before);
  });

  it.each([{}, [], { username: null }, { username: 42 }, { username: { $ne: null } },
    { username: '' }, { username: 'ab' }, { username: 'a'.repeat(31) }, { username: 'nom amb espais' },
    { username: '<script>' }])('valida username %#', async (body) => {
    expect((await auth(request(app).patch('/users/me').send(body))).status).toBe(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('no exposa cap ruta per modificar un altre usuari', async () => {
    expect((await auth(request(app).patch(`/users/${OTHER_ID}`).send({ username: 'atac' }))).status).toBe(404);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('#37 preferències', () => {
  it('consulta, substitueix, normalitza, deduplica i elimina les preferències pròpies', async () => {
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual({ preferences: [] });
    const res = await auth(request(app).put('/users/me/preferences').send({ preferences: [' Música ', 'música', 'Cinema', 'Mu\u0301sica'] }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: ['Música', 'Cinema'] });
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual(res.body);
    expect((await auth(request(app).put('/users/me/preferences').send({ preferences: ['Dansa'] }))).body).toEqual({ preferences: ['Dansa'] });
    expect((await auth(request(app).put('/users/me/preferences').send({ preferences: [] }))).body).toEqual({ preferences: [] });
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual({ preferences: [] });
    expect(users[OTHER_ID].preferences).toEqual([]);
    expect(User.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: ID, tokenVersion: 0 }, { $set: { preferences: [] } }, { new: true, runValidators: true },
    );
  });

  it('accepta les categories existents i preferències fora del catàleg d’esdeveniments', async () => {
    const preferences = [...EVENT_CATEGORIES, 'Cinema', 'Literatura', 'Dansa'];
    const res = await auth(request(app).put('/users/me/preferences').send({ preferences }));
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual(preferences);
  });

  it.each([{}, [], { preferences: null }, { preferences: 'Música' }, { preferences: [42] },
    { preferences: [{}] }, { preferences: [''] }, { preferences: ['   '] },
    { preferences: ['a'.repeat(51)] }, { preferences: ['a\nb'] }, { preferences: ['a\u200bb'] },
    { preferences: Array(31).fill('Música') }, { preferences: [], userId: OTHER_ID }])('valida la llista %#', async (body) => {
    const res = await auth(request(app).put('/users/me/preferences').send(body));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('#38 logout', () => {
  it('invalida totes les sessions anteriors, conserva el perfil i permet una sessió posterior', async () => {
    users[ID].username = 'Núria';
    users[ID].preferences = ['Cinema'];
    const secondSession = sign();
    const otherToken = sign(OTHER_ID);
    const res = await auth(request(app).post('/auth/logout'));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(User.updateOne).toHaveBeenCalledWith({ _id: ID, tokenVersion: 0 }, { $inc: { tokenVersion: 1 } });
    for (const old of [accessToken, secondSession]) {
      expect((await auth(request(app).get('/users/me'), old)).status).toBe(401);
      expect((await auth(request(app).put('/users/me/preferences').send({ preferences: [] }), old)).status).toBe(401);
      expect((await auth(request(app).post('/auth/logout'), old)).status).toBe(401);
    }
    const fresh = await auth(request(app).get('/users/me'), sign());
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ username: 'Núria', preferences: ['Cinema'] });
    expect((await auth(request(app).get('/users/me'), otherToken)).status).toBe(200);
  });

  it('un logout concurrent ja completat retorna 401', async () => {
    User.updateOne.mockResolvedValue({ matchedCount: 0 });
    expect((await auth(request(app).post('/auth/logout'))).status).toBe(401);
  });

  it('una fallada de persistència no anuncia un logout correcte', async () => {
    User.updateOne.mockRejectedValue(new Error('Mongo unavailable'));
    const res = await auth(request(app).post('/auth/logout'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
    expect((await auth(request(app).get('/users/me'))).status).toBe(200);
  });
});

describe('protecció i errors comuns', () => {
  it.each([['get', '/users/me'], ['patch', '/users/me'], ['get', '/users/me/preferences'],
    ['put', '/users/me/preferences'], ['post', '/auth/logout']])('exigeix token a %s %s', async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });

  it.each([['patch', '/users/me', { username: 'nou' }],
    ['put', '/users/me/preferences', { preferences: ['Cinema'] }]])('gestiona errors i sessions obsoletes a %s %s', async (method, path, body) => {
    User.findOneAndUpdate.mockRejectedValueOnce(new Error('internal-secret'));
    const res = await auth(request(app)[method](path).send(body));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await auth(request(app)[method](path).send(body))).status).toBe(401);
  });
});
