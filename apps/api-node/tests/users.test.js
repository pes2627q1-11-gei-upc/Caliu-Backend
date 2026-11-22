import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import Event from '../src/models/Event.js';
import Interaction from '../src/models/Interaction.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';
import { EVENT_CATEGORIES } from '../src/domain/eventCategories.js';
import app from '../src/app.js';

const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const ID = '64b7f0c2a1b2c3d4e5f60718';
const OTHER_ID = '64b7f0c2a1b2c3d4e5f60719';
const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;
let users;
let sessions;
let accessToken;
const clone = (value) => value && structuredClone(value);
function sign(id = ID) {
  const jti = randomBytes(32).toString('hex');
  sessions.set(jti, { userId: id, expiresAt: new Date(Date.now() + 3600000) });
  return jwt.sign({ jti }, SECRET, {
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
  sessions = new Map();
  accessToken = sign();
  jest.spyOn(User, 'findById').mockImplementation((id) => ({
    lean: async () => clone(users[id]),
  }));
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation(async (filter, update) => {
    const user = users[filter._id];
    if (!user) return null;
    Object.assign(user, update.$set);
    return clone(user);
  });
  jest.spyOn(Session, 'exists').mockImplementation(async (filter) => {
    const session = sessions.get(filter.jti);
    return session && session.userId === String(filter.userId) && session.expiresAt > filter.expiresAt.$gt
      ? { _id: 'session' } : null;
  });
  jest.spyOn(Session, 'deleteOne').mockImplementation(async (filter) => {
    const session = sessions.get(filter.jti);
    if (!session || session.userId !== String(filter.userId)) return { deletedCount: 0 };
    sessions.delete(filter.jti);
    return { deletedCount: 1 };
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
      { _id: ID }, { $set: { username: 'Núria_42' } }, { new: true, runValidators: true },
    );
    expect((await auth(request(app).get('/users/me'))).body.username).toBe('Núria_42');
    expect(users[OTHER_ID]).toEqual(other);
  });

  it('retorna 409 si el nou username ja està ocupat, incloses majúscules', async () => {
    User.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000, keyPattern: { username: 1 } }));
    const res = await auth(request(app).patch('/users/me').send({ username: 'COMPARTIT' }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'El username ja està ocupat' });
  });

  it.each(['email', 'password', 'passwordHash', 'role', 'tokenVersion', '_id', 'id', 'userId', 'preferences', 'proximitatKm', '__v', '$set'])('rebutja mass assignment de %s', async (key) => {
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
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual({ preferences: [], proximitatKm: null });
    const res = await auth(request(app).put('/users/me/preferences').send({ preferences: [' Música ', 'música', 'Teatre', 'Mu\u0301sica'] }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: ['Música', 'Teatre'], proximitatKm: null });
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual(res.body);
    expect((await auth(request(app).put('/users/me/preferences').send({ preferences: ['Arts'] }))).body).toEqual({ preferences: ['Arts'], proximitatKm: null });
    expect((await auth(request(app).put('/users/me/preferences').send({ preferences: [] }))).body).toEqual({ preferences: [], proximitatKm: null });
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual({ preferences: [], proximitatKm: null });
    expect(users[OTHER_ID].preferences).toEqual([]);
    expect(User.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: ID }, { $set: { preferences: [] } }, { new: true, runValidators: true },
    );
  });

  it('accepta exactament totes les categories existents', async () => {
    const preferences = [...EVENT_CATEGORIES];
    const res = await auth(request(app).put('/users/me/preferences').send({ preferences }));
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual(preferences);
  });

  it.each([{}, [], { preferences: null }, { preferences: 'Música' }, { preferences: [42] },
    { preferences: [{}] }, { preferences: ['Cinema'] }, { preferences: ['musica'] }, { preferences: [''] }, { preferences: ['   '] },
    { preferences: ['a'.repeat(51)] }, { preferences: ['a\nb'] }, { preferences: ['a\u200bb'] },
    { preferences: Array(31).fill('Música') }, { preferences: [], userId: OTHER_ID }, { proximitatKm: 10 }])('valida la llista %#', async (body) => {
    const res = await auth(request(app).put('/users/me/preferences').send(body));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('#123 proximitatKm', () => {
  const put = (body) => auth(request(app).put('/users/me/preferences').send(body));

  it('desa, consulta i esborra el radi d\'activitat propi', async () => {
    const res = await put({ preferences: ['Teatre'], proximitatKm: 12.5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: ['Teatre'], proximitatKm: 12.5 });
    expect((await auth(request(app).get('/users/me/preferences'))).body).toEqual(res.body);
    expect((await put({ preferences: ['Teatre'], proximitatKm: null })).body).toEqual({ preferences: ['Teatre'], proximitatKm: null });
    expect(users[OTHER_ID].proximitatKm).toBeUndefined();
  });

  it('manté el radi si només es canvien les categories', async () => {
    await put({ preferences: [], proximitatKm: 30 });
    const res = await put({ preferences: ['Arts'] });
    expect(res.body).toEqual({ preferences: ['Arts'], proximitatKm: 30 });
    expect(User.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: ID }, { $set: { preferences: ['Arts'] } }, { new: true, runValidators: true },
    );
  });

  it.each([0.1, 500])('accepta el límit %p', async (proximitatKm) => {
    const res = await put({ preferences: [], proximitatKm });
    expect(res.status).toBe(200);
    expect(res.body.proximitatKm).toBe(proximitatKm);
  });

  it.each([-1, 0, 0.09, 500.1, '5', true, {}, []])('rebutja proximitatKm %p', async (proximitatKm) => {
    const res = await put({ preferences: [], proximitatKm });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('#38 logout', () => {
  it('invalida només A, conserva B i un altre usuari, i permet una sessió posterior', async () => {
    users[ID].username = 'Núria';
    users[ID].preferences = ['Teatre'];
    const secondSession = sign();
    const otherToken = sign(OTHER_ID);
    const res = await auth(request(app).post('/auth/logout'));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(Session.deleteOne).toHaveBeenCalledWith({ userId: ID, jti: jwt.decode(accessToken).jti, expiresAt: { $gt: expect.any(Date) } });
    for (const old of [accessToken]) {
      expect((await auth(request(app).get('/users/me'), old)).status).toBe(401);
      expect((await auth(request(app).put('/users/me/preferences').send({ preferences: [] }), old)).status).toBe(401);
      expect((await auth(request(app).post('/auth/logout'), old)).status).toBe(401);
    }
    expect((await auth(request(app).get('/users/me'), secondSession)).status).toBe(200);
    const fresh = await auth(request(app).get('/users/me'), sign());
    expect((await auth(request(app).get('/users/me'), secondSession)).status).toBe(200);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ username: 'Núria', preferences: ['Teatre'] });
    expect((await auth(request(app).get('/users/me'), otherToken)).status).toBe(200);
  });

  it('un logout concurrent ja completat retorna 401', async () => {
    Session.deleteOne.mockResolvedValue({ deletedCount: 0 });
    expect((await auth(request(app).post('/auth/logout'))).status).toBe(401);
  });

  it('una fallada de persistència no anuncia un logout correcte', async () => {
    Session.deleteOne.mockRejectedValue(new Error('Mongo unavailable'));
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
    ['put', '/users/me/preferences', { preferences: ['Teatre'] }]])('gestiona errors i sessions obsoletes a %s %s', async (method, path, body) => {
    User.findOneAndUpdate.mockRejectedValueOnce(new Error('internal-secret'));
    const res = await auth(request(app)[method](path).send(body));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    expect((await auth(request(app)[method](path).send(body))).status).toBe(401);
  });
});

describe('#185 alta de preferits', () => {
  const path = '/users/me/favorites';
  const eventId = '64b7f0c2a1b2c3d4e5f60720';

  beforeEach(() => {
    jest.spyOn(Event, 'exists').mockResolvedValue({ _id: eventId });
    jest.spyOn(Interaction, 'updateOne').mockResolvedValue({ upsertedCount: 1 });
  });

  it('exigeix autenticació i valida l’identificador abans de consultar Mongo', async () => {
    expect((await request(app).post(path).send({ eventId })).status).toBe(401);
    expect((await auth(request(app).post(path)).send({ eventId: 'invalid' })).status).toBe(400);
    expect(Event.exists).not.toHaveBeenCalled();
    expect(Interaction.updateOne).not.toHaveBeenCalled();
  });

  it('retorna 404 si l’esdeveniment no existeix', async () => {
    Event.exists.mockResolvedValueOnce(null);
    expect((await auth(request(app).post(path)).send({ eventId })).status).toBe(404);
    expect(Interaction.updateOne).not.toHaveBeenCalled();
  });

  it('retorna 204 tant si insereix com si el preferit ja existia', async () => {
    Interaction.updateOne.mockResolvedValueOnce({ upsertedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, upsertedCount: 0 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await auth(request(app).post(path)).send({ eventId, userId: OTHER_ID });
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
    }
    expect(Interaction.updateOne).toHaveBeenCalledTimes(2);
    expect(Interaction.updateOne).toHaveBeenLastCalledWith(
      { userId: ID, type: 'favorite', eventId },
      { $setOnInsert: { createdAt: expect.any(Date), updatedAt: expect.any(Date), notificacionsActives: true } },
      { upsert: true, timestamps: false },
    );
  });

  it('accepta una alta concurrent i propaga altres errors de Mongo', async () => {
    Interaction.updateOne.mockRejectedValueOnce(Object.assign(new Error(), {
      code: 11000, keyPattern: { userId: 1, type: 1, eventId: 1 },
    })).mockRejectedValueOnce(new Error('Mongo unavailable'));
    expect((await auth(request(app).post(path)).send({ eventId })).status).toBe(204);
    expect((await auth(request(app).post(path)).send({ eventId })).status).toBe(500);
  });
});

describe('#166 baixa de preferits', () => {
  const eventId = '64b7f0c2a1b2c3d4e5f60720';
  const path = `/users/me/favorites/${eventId}`;

  beforeEach(() => {
    jest.spyOn(Interaction, 'deleteOne').mockResolvedValue({ deletedCount: 1 });
  });

  it('exigeix una sessió vàlida abans d’eliminar', async () => {
    expect((await request(app).delete(path)).status).toBe(401);
    expect((await auth(request(app).delete(path), 'invalid')).status).toBe(401);
    expect(Interaction.deleteOne).not.toHaveBeenCalled();
  });

  it('rebutja un identificador invàlid', async () => {
    expect((await auth(request(app).delete('/users/me/favorites/no-valid'))).status).toBe(400);
    expect(Interaction.deleteOne).not.toHaveBeenCalled();
  });

  it('elimina només el preferit de l’usuari autenticat i retorna 204 també en repetir', async () => {
    Interaction.deleteOne.mockResolvedValueOnce({ deletedCount: 1 })
      .mockResolvedValueOnce({ deletedCount: 0 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await auth(request(app).delete(path).send({ userId: OTHER_ID }));
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
    }

    expect(Interaction.deleteOne.mock.calls).toEqual([
      [{ userId: ID, type: 'favorite', eventId }],
      [{ userId: ID, type: 'favorite', eventId }],
    ]);
  });

  it('propaga les fallades de persistència', async () => {
    Interaction.deleteOne.mockRejectedValueOnce(new Error('Mongo unavailable'));
    expect((await auth(request(app).delete(path))).status).toBe(500);
  });
});

describe('#151 guardats i activitat', () => {
  const eventId = '64b7f0c2a1b2c3d4e5f60720';
  const interactionId = '64b7f0c2a1b2c3d4e5f60721';
  const createdAt = new Date('2026-11-18T12:00:00Z');
  const doc = { _id: interactionId, eventId: { _id: eventId, title: 'Concert', __v: 0 }, createdAt };
  let lean;
  let sort;

  beforeEach(() => {
    lean = jest.fn().mockResolvedValue([doc, { eventId: null }]);
    sort = jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ lean }) });
    jest.spyOn(Interaction, 'find').mockReturnValue({ sort });
  });

  it.each([
    ['favorites', 'favorite', { id: eventId, title: 'Concert', isFavorite: true, notificacionsActives: true }],
    ['activity', 'attended', { id: interactionId, event: { id: eventId, title: 'Concert' }, attendedAt: createdAt.toISOString() }],
  ])('retorna només les interaccions pròpies a /%s', async (route, type, item) => {
    const res = await auth(request(app).get(`/users/me/${route}?userId=${OTHER_ID}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [item] });
    expect(Interaction.find).toHaveBeenCalledWith({ userId: ID, type });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });

  it.each(['favorites', 'activity'])('retorna una llista buida i exigeix sessió a /%s', async (route) => {
    const path = `/users/me/${route}`;
    expect((await request(app).get(path)).status).toBe(401);
    expect(Interaction.find).not.toHaveBeenCalled();
    lean.mockResolvedValueOnce([]);
    expect((await auth(request(app).get(path))).body).toEqual({ items: [] });
    lean.mockRejectedValueOnce(new Error('Mongo unavailable'));
    expect((await auth(request(app).get(path))).status).toBe(500);
  });
});

describe('#168 historial d’assistència', () => {
  const path = '/users/me/attended';
  let populate;
  let lean;

  beforeEach(() => {
    lean = jest.fn().mockResolvedValue([]);
    populate = jest.fn().mockReturnValue({ lean });
    jest.spyOn(Interaction, 'find').mockReturnValue({ populate });
  });

  it('demana només assistències pròpies i esdeveniments acabats', async () => {
    const older = { _id: '64b7f0c2a1b2c3d4e5f60720', endDate: new Date('2026-10-15') };
    const newer = { _id: '64b7f0c2a1b2c3d4e5f60721', endDate: new Date('2026-11-01') };
    lean.mockResolvedValueOnce([{ eventId: older }, { eventId: null }, { eventId: newer }]);
    const before = Date.now();
    const res = await auth(request(app).get(`${path}?userId=${OTHER_ID}`));

    expect(res.status).toBe(200);
    expect(res.body.items.map(({ id }) => id)).toEqual([newer._id, older._id]);
    expect(Interaction.find).toHaveBeenCalledWith({ userId: ID, type: 'attended' });
    expect(populate).toHaveBeenCalledWith({ path: 'eventId', match: { endDate: { $lt: expect.any(Date) } } });
    const cutoff = populate.mock.calls[0][0].match.endDate.$lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(Date.now());
  });

  it('requereix sessió i retorna items buits si no hi ha resultats', async () => {
    expect((await request(app).get(path)).status).toBe(401);
    expect(Interaction.find).not.toHaveBeenCalled();
    const res = await auth(request(app).get(path));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    lean.mockRejectedValueOnce(new Error('Mongo unavailable'));
    expect((await auth(request(app).get(path))).status).toBe(500);
  });
});

describe('#170 alertes dels preferits', () => {
  const eventId = '64b7f0c2a1b2c3d4e5f60720';
  const path = `/users/me/favorites/${eventId}`;

  beforeEach(() => {
    jest.spyOn(Interaction, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
  });

  it.each([false, true])('desa notificacionsActives=%s només al preferit propi', async (enabled) => {
    const res = await auth(request(app).patch(path)).send({ notificacionsActives: enabled, userId: OTHER_ID });
    expect(res.status).toBe(204);
    expect(Interaction.updateOne).toHaveBeenCalledWith(
      { userId: ID, type: 'favorite', eventId },
      { $set: { notificacionsActives: enabled } },
    );
  });

  it('conserva el valor false quan es torna a consultar el preferit', async () => {
    jest.spyOn(Interaction, 'find').mockReturnValue({
      sort: () => ({ populate: () => ({ lean: async () => [
        { eventId: { _id: eventId }, notificacionsActives: false },
      ] }) }),
    });
    const res = await auth(request(app).get('/users/me/favorites'));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ id: eventId, isFavorite: true, notificacionsActives: false }]);
  });

  it('rebutja peticions sense sessió, amb ID invàlid o amb un valor no booleà', async () => {
    expect((await request(app).patch(path).send({ notificacionsActives: true })).status).toBe(401);
    expect((await auth(request(app).patch('/users/me/favorites/no-valid')).send({ notificacionsActives: true })).status).toBe(400);
    expect((await auth(request(app).patch(path)).send({ notificacionsActives: 'false' })).status).toBe(400);
    expect(Interaction.updateOne).not.toHaveBeenCalled();
  });

  it('retorna 404 si el preferit no existeix i 500 si falla la persistència', async () => {
    Interaction.updateOne.mockResolvedValueOnce({ matchedCount: 0 })
      .mockRejectedValueOnce(new Error('Mongo unavailable'));
    expect((await auth(request(app).patch(path)).send({ notificacionsActives: false })).status).toBe(404);
    expect((await auth(request(app).patch(path)).send({ notificacionsActives: false })).status).toBe(500);
  });
});
