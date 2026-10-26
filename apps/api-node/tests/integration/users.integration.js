import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import Session from '../../src/models/Session.js';
import { initializeUserIndexes, auditUsers } from '../../src/config/userIndexes.js';
import { authRateLimitStore } from '../../src/middlewares/authRateLimit.js';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import Event from '../../src/models/Event.js';

// Opt-in explícit i destí restringit: mai es reutilitza MONGO_URI ni es llegeix .env.
const uri = process.env.TEST_MONGO_URI;
if (!uri) throw new Error('Cal TEST_MONGO_URI amb una instància MongoDB efímera de test');
const destination = new URL(uri);
if (destination.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(destination.hostname)
  || destination.pathname !== '/caliu_users_integration_test' || destination.username || destination.password
  || destination.search) {
  throw new Error('TEST_MONGO_URI ha d’apuntar a localhost/caliu_users_integration_test sense credencials ni opcions');
}

const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;
const PASSWORD = 'Contrasenya-test-42';
const register = (email, username = email.trim().split('@')[0]) => request(app).post('/auth/register').send({ username, email, password: PASSWORD });
const login = (email) => request(app).post('/auth/login').send({ email, password: PASSWORD });
const auth = (req, token) => req.auth(token, { type: 'bearer' });

beforeAll(async () => {
  process.env.JWT_SECRET = 'caliu-integration-test-only-secret-32-bytes';
  process.env.JWT_TTL_SECONDS = '3600';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await initializeUserIndexes();
  await Session.init();
  await Event.init();
}, 15000);
beforeEach(async () => {
  authRateLimitStore.resetAll();
  await Session.deleteMany({});
  await User.deleteMany({});
  await Event.deleteMany({});
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTtl === undefined) delete process.env.JWT_TTL_SECONDS;
  else process.env.JWT_TTL_SECONDS = originalTtl;
});

it('desa només el hash amb salt i normalitza el correu a MongoDB', async () => {
  const res = await register('  PERSONA@EXAMPLE.CAT  ');
  expect(res.status).toBe(201);
  const stored = await User.findOne({ email: 'persona@example.cat' }).select('+passwordHash').lean();
  expect(stored.password).toBeUndefined();
  expect(await bcrypt.compare(PASSWORD, stored.passwordHash)).toBe(true);
  expect(stored.passwordHash).not.toBe(PASSWORD);
  expect(await Session.countDocuments({ userId: stored._id })).toBe(1);
  expect((await auth(request(app).get('/users/me'), res.body.token)).status).toBe(200);
  expect((await User.findById(stored._id).lean()).passwordHash).toBeUndefined();
  expect((await User.findById(stored._id).lean()).tokenVersion).toBeUndefined();
  expect(res.body.user).toEqual({ id: String(stored._id), email: stored.email, username: 'PERSONA', preferences: [] });
});

it('l’índex únic rebutja correus equivalents en registres concurrents amb 409', async () => {
  const results = await Promise.all([register('DUPLICAT@example.cat', 'primer'), register('duplicat@EXAMPLE.CAT', 'segon')]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(await User.countDocuments()).toBe(1);
});

it('l’índex real garanteix unicitat de username case-insensitive també en cursa', async () => {
  const results = await Promise.all([register('primer@example.cat', 'Quim_42'), register('segon@example.cat', 'quim_42')]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(await User.countDocuments()).toBe(1);
  expect(await Session.countDocuments()).toBe(1);
  expect(results.find((res) => res.status === 409).body).toEqual({ error: 'El username ja està ocupat' });
});

it('la unicitat conserva Unicode NFC i grafia visible, diferencia accents i admet lletres astrals', async () => {
  const first = await register('primer@example.cat', '  Núria_42  ');
  expect(first.status).toBe(201);
  expect(first.body.user.username).toBe('Núria_42');
  expect((await register('segon@example.cat', 'NU\u0301RIA_42')).status).toBe(409);
  expect((await register('tercer@example.cat', 'Nuria_42')).status).toBe(201);
  const astral = await register('astral@example.cat', '\u{10400}'.repeat(20));
  expect(astral.status).toBe(201);
  expect((await register('astral2@example.cat', '\u{10428}'.repeat(20))).status).toBe(409);
});

it('els índexs de username i sessions existeixen amb unicitat i TTL reals', async () => {
  const userIndexes = await User.collection.indexes();
  const index = userIndexes.find((value) => value.name === 'username_unique_ci');
  expect(index.unique).toBe(true);
  expect(index.collation).toMatchObject({ locale: 'ca', strength: 2, normalization: true });
  expect(index.partialFilterExpression).toEqual({ username: { $type: 'string' } });
  const sessionIndexes = await Session.collection.indexes();
  expect(sessionIndexes.find((value) => value.key.jti === 1).unique).toBe(true);
  expect(sessionIndexes.find((value) => value.key.expiresAt === 1).expireAfterSeconds).toBe(0);
});

it('l’auditoria detecta duplicats antics abans de crear l’índex i no modifica dades', async () => {
  await User.collection.dropIndex('username_unique_ci');
  try {
    const { insertedIds } = await User.collection.insertMany([
      { email: 'legacy1@example.cat', username: 'Quim', preferences: [] },
      { email: 'legacy2@example.cat', username: 'QUIM', preferences: [] },
      { email: 'legacy3@example.cat', username: ' nom amb espais ', preferences: ['Cinema'] },
    ]);
    const before = await User.collection.find().toArray();
    const report = await auditUsers();
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.invalidUserIds).toContain(String(insertedIds[2]));
    expect(report.nonCanonicalPreferencesIds).toContain(String(insertedIds[2]));
    await expect(initializeUserIndexes()).rejects.toMatchObject({ name: 'UserMigrationRequired' });
    expect(await User.collection.find().toArray()).toEqual(before);
    expect((await User.collection.indexes()).some((index) => index.name === 'username_unique_ci')).toBe(false);
  } finally {
    await User.deleteMany({});
    await initializeUserIndexes();
  }
});

it('els comptes antics amb username nul es conserven i poden regularitzar-se amb PATCH', async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await User.collection.insertMany([
    { email: 'legacy1@example.cat', username: null, passwordHash, preferences: [] },
    { email: 'legacy2@example.cat', passwordHash, preferences: [] },
  ]);
  const report = await initializeUserIndexes();
  expect(report.legacyUsernameIds).toHaveLength(2);
  const session = await login('legacy1@example.cat');
  expect(session.status).toBe(200);
  expect(session.body.user.username).toBeNull();
  const updated = await auth(request(app).patch('/users/me').send({ username: 'Regularitzat' }), session.body.token);
  expect(updated.status).toBe(200);
  expect(updated.body.user).toBeUndefined();
  expect(updated.body.username).toBe('Regularitzat');
  expect((await register('nou@example.cat', 'regularitzat')).status).toBe(409);
  expect(await User.countDocuments()).toBe(2);
});

it('una fallada en crear la sessió del registre no deixa cap compte parcial', async () => {
  const spy = jest.spyOn(Session, 'create').mockRejectedValue(new Error('synthetic persistence failure'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await register('parcial@example.cat');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
    expect(await User.countDocuments()).toBe(0);
    expect(await Session.countDocuments()).toBe(0);
  } finally { spy.mockRestore(); log.mockRestore(); }
});

it('rebutja sessió absent, d’un altre usuari, expirada a Mongo i JWT antic sense jti', async () => {
  const first = await register('primer@example.cat');
  const second = await register('segon@example.cat');
  const firstPayload = jwt.decode(first.body.token);
  const secondPayload = jwt.decode(second.body.token);
  const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const absent = sign({ ...firstPayload, jti: 'f'.repeat(64) });
  const other = sign({ ...firstPayload, jti: secondPayload.jti });
  const { jti, ...legacy } = firstPayload;
  const old = sign({ ...legacy, tokenVersion: 0 });
  for (const token of [absent, other, old]) {
    expect((await auth(request(app).get('/users/me'), token)).status).toBe(401);
  }
  // El JWT segueix vigent; el middleware ha de comprovar expiresAt a Mongo.
  await Session.updateOne({ jti }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await auth(request(app).get('/users/me'), first.body.token)).status).toBe(401);
  expect((await auth(request(app).get('/users/me'), second.body.token)).status).toBe(200);
});

it('login comprova la contrasenya desada i no revela si el compte existeix', async () => {
  await register('persona@example.cat');
  expect((await login('PERSONA@EXAMPLE.CAT')).status).toBe(200);
  const wrong = await request(app).post('/auth/login').send({ email: 'persona@example.cat', password: 'password-equivocat' });
  const missing = await login('inexistent@example.cat');
  expect(wrong.status).toBe(401);
  expect(missing.status).toBe(401);
  expect(wrong.body).toEqual(missing.body);
});

it('persisteix el perfil propi, rebutja mass assignment i conserva l’altre usuari', async () => {
  await register('persona@example.cat');
  const other = await register('altra@example.cat');
  const { body: { token } } = await login('persona@example.cat');
  const changed = await auth(request(app).patch('/users/me').send({ username: 'Núria_42' }), token);
  expect(changed.status).toBe(200);
  expect((await auth(request(app).get('/users/me'), token)).body.username).toBe('Núria_42');
  expect((await User.findOne({ email: 'persona@example.cat' })).username).toBe('Núria_42');
  expect((await User.findById(other.body.user.id)).username).toBe('altra');
  const conflict = await auth(request(app).patch('/users/me').send({ username: 'ALTRA' }), token);
  expect(conflict.status).toBe(409);
  expect((await auth(request(app).get('/users/me'), token)).body.username).toBe('Núria_42');
  const attack = await auth(request(app).patch('/users/me').send({ username: 'atac', _id: other.body.user.id, tokenVersion: 12 }), token);
  expect(attack.status).toBe(400);
  expect((await auth(request(app).get('/users/me'), token)).body.username).toBe('Núria_42');
});

it('desa, substitueix i buida preferències sense afectar altres usuaris', async () => {
  await register('persona@example.cat');
  await register('altra@example.cat');
  const { body: { token } } = await login('persona@example.cat');
  const set = (preferences) => auth(request(app).put('/users/me/preferences').send({ preferences }), token);
  expect((await set([' Música ', 'música', 'Teatre'])).body).toEqual({ preferences: ['Música', 'Teatre'] });
  expect((await User.findOne({ email: 'persona@example.cat' })).preferences).toEqual(['Música', 'Teatre']);
  expect((await set(['Cinema'])).status).toBe(400);
  expect((await User.findOne({ email: 'persona@example.cat' })).preferences).toEqual(['Música', 'Teatre']);
  expect((await set(['Arts'])).body).toEqual({ preferences: ['Arts'] });
  expect((await set([])).status).toBe(200);
  expect((await User.findOne({ email: 'persona@example.cat' })).preferences).toEqual([]);
  expect((await User.findOne({ email: 'altra@example.cat' })).preferences).toEqual([]);
  expect((await auth(request(app).get('/users/me/preferences'), token)).body).toEqual({ preferences: [] });
});

it('logout invalida només A, conserva B i un altre usuari i admet un nou login', async () => {
  const registered = await register('persona@example.cat');
  const otherRegistration = await register('altra@example.cat');
  const first = registered.body.token;
  const second = (await login('persona@example.cat')).body.token;
  const other = otherRegistration.body.token;
  expect(await Session.countDocuments({ userId: registered.body.user.id })).toBe(2);
  await auth(request(app).patch('/users/me').send({ username: 'Núria' }), first);
  await auth(request(app).put('/users/me/preferences').send({ preferences: ['Teatre'] }), first);
  expect((await auth(request(app).post('/auth/logout'), first)).status).toBe(204);
  for (const value of [first]) {
    expect((await auth(request(app).get('/users/me'), value)).status).toBe(401);
    expect((await auth(request(app).post('/auth/logout'), value)).status).toBe(401);
  }
  expect((await auth(request(app).get('/users/me'), other)).status).toBe(200);
  expect((await auth(request(app).get('/users/me'), second)).status).toBe(200);
  const fresh = (await login('persona@example.cat')).body.token;
  const profile = await auth(request(app).get('/users/me'), fresh);
  expect(profile.status).toBe(200);
  expect(profile.body).toMatchObject({ username: 'Núria', preferences: ['Teatre'] });
  expect((await auth(request(app).get('/users/me'), second)).status).toBe(200);
  expect(await Session.countDocuments({ userId: profile.body.id })).toBe(2);
});

it('un usuari eliminat ja no pot utilitzar el seu JWT encara que no hagi expirat', async () => {
  await register('persona@example.cat');
  const { body: { token } } = await login('persona@example.cat');
  await User.deleteOne({ email: 'persona@example.cat' });
  expect((await auth(request(app).get('/users/me'), token)).status).toBe(401);
});

it('els endpoints d’esdeveniments continuen públics amb persistència real', async () => {
  const event = await Event.create({ code: 'integration-only', title: 'Concert de prova', startDate: new Date('2099-10-21'), categories: ['Música'] });
  expect((await request(app).get('/events/categories')).status).toBe(200);
  const list = await request(app).get('/events');
  expect(list.status).toBe(200);
  expect(list.body.total).toBe(1);
  expect((await request(app).get(`/events/${event.id}`)).body.title).toBe('Concert de prova');
  expect((await request(app).get('/events/search?q=concert')).body.total).toBe(1);
});
