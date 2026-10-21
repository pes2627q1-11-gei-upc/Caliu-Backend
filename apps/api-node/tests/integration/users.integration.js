import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
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
const register = (email) => request(app).post('/auth/register').send({ email, password: PASSWORD });
const login = (email) => request(app).post('/auth/login').send({ email, password: PASSWORD });
const auth = (req, token) => req.auth(token, { type: 'bearer' });

beforeAll(async () => {
  process.env.JWT_SECRET = 'caliu-integration-test-only-secret-32-bytes';
  process.env.JWT_TTL_SECONDS = '3600';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await User.init();
  await Event.init();
}, 15000);
beforeEach(async () => {
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
  const stored = await User.findOne({ email: 'persona@example.cat' }).select('+passwordHash +tokenVersion').lean();
  expect(stored.password).toBeUndefined();
  expect(await bcrypt.compare(PASSWORD, stored.passwordHash)).toBe(true);
  expect(stored.passwordHash).not.toBe(PASSWORD);
  expect(stored.tokenVersion).toBe(0);
  expect((await User.findById(stored._id).lean()).passwordHash).toBeUndefined();
  expect((await User.findById(stored._id).lean()).tokenVersion).toBeUndefined();
  expect(res.body.user).toEqual({ id: String(stored._id), email: stored.email, username: null, preferences: [] });
});

it('l’índex únic rebutja correus equivalents en registres concurrents amb 409', async () => {
  const results = await Promise.all([register('DUPLICAT@example.cat'), register('duplicat@EXAMPLE.CAT')]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  expect(await User.countDocuments()).toBe(1);
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
  expect((await User.findById(other.body.user.id)).username).toBeNull();
  const attack = await auth(request(app).patch('/users/me').send({ username: 'atac', _id: other.body.user.id, tokenVersion: 12 }), token);
  expect(attack.status).toBe(400);
  expect((await auth(request(app).get('/users/me'), token)).body.username).toBe('Núria_42');
});

it('desa, substitueix i buida preferències sense afectar altres usuaris', async () => {
  await register('persona@example.cat');
  await register('altra@example.cat');
  const { body: { token } } = await login('persona@example.cat');
  const set = (preferences) => auth(request(app).put('/users/me/preferences').send({ preferences }), token);
  expect((await set([' Música ', 'música', 'Cinema'])).body).toEqual({ preferences: ['Música', 'Cinema'] });
  expect((await User.findOne({ email: 'persona@example.cat' })).preferences).toEqual(['Música', 'Cinema']);
  expect((await set(['Dansa'])).body).toEqual({ preferences: ['Dansa'] });
  expect((await set([])).status).toBe(200);
  expect((await User.findOne({ email: 'persona@example.cat' })).preferences).toEqual([]);
  expect((await User.findOne({ email: 'altra@example.cat' })).preferences).toEqual([]);
  expect((await auth(request(app).get('/users/me/preferences'), token)).body).toEqual({ preferences: [] });
});

it('logout invalida totes les sessions, conserva dades i admet un nou login', async () => {
  await register('persona@example.cat');
  await register('altra@example.cat');
  const first = (await login('persona@example.cat')).body.token;
  const second = (await login('persona@example.cat')).body.token;
  const other = (await login('altra@example.cat')).body.token;
  await auth(request(app).patch('/users/me').send({ username: 'Núria' }), first);
  await auth(request(app).put('/users/me/preferences').send({ preferences: ['Cinema'] }), first);
  expect((await auth(request(app).post('/auth/logout'), first)).status).toBe(204);
  for (const value of [first, second]) {
    expect((await auth(request(app).get('/users/me'), value)).status).toBe(401);
    expect((await auth(request(app).post('/auth/logout'), value)).status).toBe(401);
  }
  expect((await auth(request(app).get('/users/me'), other)).status).toBe(200);
  const fresh = (await login('persona@example.cat')).body.token;
  const profile = await auth(request(app).get('/users/me'), fresh);
  expect(profile.status).toBe(200);
  expect(profile.body).toMatchObject({ username: 'Núria', preferences: ['Cinema'] });
  expect((await User.findOne({ email: 'persona@example.cat' }).select('+tokenVersion')).tokenVersion).toBe(1);
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
