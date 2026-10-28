import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import { authRateLimitStore } from '../src/middlewares/authRateLimit.js';
import app from '../src/app.js';
import { getAuthConfig } from '../src/config/auth.js';

// Només dades sintètiques i models simulats: cap connexió MongoDB.
const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const PASSWORD = 'Contrasenya-de-prova-42';
const ID = '64b7f0c2a1b2c3d4e5f60718';
const JTI = 'a'.repeat(64);
let user;
let storedHash;
const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;

beforeAll(async () => { storedHash = await bcrypt.hash(PASSWORD, 12); });
beforeEach(() => {
  authRateLimitStore.resetAll();
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_TTL_SECONDS = '3600';
  user = { _id: ID, email: 'prova@example.cat', username: 'Prova_42', preferences: [],
    tokenVersion: 0, passwordHash: storedHash };
  jest.spyOn(User, 'create').mockImplementation(async (data) => { user = { ...user, ...data }; return user; });
  jest.spyOn(User, 'findOne').mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
  jest.spyOn(User, 'findById').mockImplementation(() => ({ lean: async () => user }));
  jest.spyOn(Session, 'create').mockImplementation(async (data) => data);
  jest.spyOn(Session, 'exists').mockResolvedValue({ _id: 'session' });
  jest.spyOn(Session, 'deleteOne').mockResolvedValue({ deletedCount: 1 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTtl === undefined) delete process.env.JWT_TTL_SECONDS;
  else process.env.JWT_TTL_SECONDS = originalTtl;
});

const credentials = { email: 'prova@example.cat', password: PASSWORD };
const registration = { ...credentials, username: 'Prova_42' };
function token(payload = {}, options = {}) {
  return jwt.sign({ jti: JTI, ...payload }, SECRET, {
    algorithm: 'HS256', subject: ID, issuer: 'caliu-api', audience: 'caliu-android',
    expiresIn: 3600, ...options,
  });
}
const assertError = (res, status) => {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(['error']);
  expect(typeof res.body.error).toBe('string');
};

describe('#39 registre', () => {
  it('si falla la sessió, no crea cap compte ni retorna un token', async () => {
    Session.create.mockRejectedValue(new Error('Mongo unavailable'));
    const res = await request(app).post('/auth/register').send(registration);
    assertError(res, 500);
    expect(res.body).not.toHaveProperty('token');
    expect(User.create).not.toHaveBeenCalled();
  });

  it('retorna 409 per username duplicat i neteja només la sessió òrfena', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000, keyPattern: { username: 1 } }));
    const res = await request(app).post('/auth/register').send(registration);
    assertError(res, 409);
    expect(res.body.error).toBe('El username ja està ocupat');
    const session = Session.create.mock.calls[0][0];
    expect(Session.deleteOne).toHaveBeenCalledWith({ userId: session.userId, jti: session.jti });
  });

  it('una neteja fallida no amaga el conflicte ni filtra errors', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    Session.deleteOne.mockRejectedValue(new Error('private URI'));
    const res = await request(app).post('/auth/register').send(registration);
    assertError(res, 409);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('private URI');
  });

  it('accepta el límit exacte de 72 bytes UTF-8 sense truncació', async () => {
    const password = 'é'.repeat(36);
    const res = await request(app).post('/auth/register').send({ ...registration, password });
    expect(res.status).toBe(201);
    expect(await bcrypt.compare(password, User.create.mock.calls[0][0].passwordHash)).toBe(true);
  });
  it('crea un usuari, normalitza el correu i desa bcrypt amb salt i cost 12', async () => {
    const res = await request(app).post('/auth/register').send({ ...registration, email: '  PROVA@EXAMPLE.CAT ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ user: { id: String(user._id), email: credentials.email, username: 'Prova_42', preferences: [] }, tokenType: 'Bearer', expiresIn: 3600 });
    expect((await request(app).get('/users/me').auth(res.body.token, { type: 'bearer' })).status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = User.create.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['_id', 'email', 'passwordHash', 'username']);
    expect(data.email).toBe(credentials.email);
    expect(data.passwordHash).not.toBe(PASSWORD);
    expect(bcrypt.getRounds(data.passwordHash)).toBe(12);
    expect(await bcrypt.compare(PASSWORD, data.passwordHash)).toBe(true);
    expect(data.passwordHash).not.toBe(storedHash); // salt diferent per al mateix password
  });

  it.each([
    {}, { email: credentials.email }, { ...registration, email: null },
    { ...registration, email: { $ne: null } }, { ...registration, email: 'a..b@example.cat' },
    { ...registration, email: 'a@-bad.cat' }, { ...registration, email: 'a@localhost' },
    { ...registration, email: `${'a'.repeat(65)}@example.cat` },
    { ...registration, password: 12345678 }, { ...registration, password: 'curta' },
    { ...registration, password: 'a'.repeat(73) }, { ...registration, password: 'é'.repeat(37) },
    { ...registration, password: '        ' }, { ...registration, password: 'password\n' },
    { ...registration, role: 'admin' }, credentials, { ...registration, username: null },
    { ...registration, username: 'ab' }, { ...registration, username: 'a'.repeat(31) },
    { ...registration, username: 'nom amb espais' }, [],
  ])('rebutja entrada invàlida %# sense escriure a Mongo', async (body) => {
    const res = await request(app).post('/auth/register').send(body);
    assertError(res, 400);
    expect(User.create).not.toHaveBeenCalled();
  });

  it('retorna 409 per duplicat d’índex únic (inclosa la cursa entre registres)', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('document amb secrets'), { code: 11000 }));
    const res = await request(app).post('/auth/register').send(registration);
    assertError(res, 409);
    expect(res.body.error).toBe('El correu ja està registrat');
  });

  it('classifica correctament un duplicat d’email quan l’error només porta keyValue', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyValue: { email: 'prova@example.cat' },
    }));
    const res = await request(app).post('/auth/register').send(registration);
    assertError(res, 409);
    expect(res.body.error).toBe('El correu ja està registrat');
  });

  it('retorna 500 genèric i no imprimeix dades de persistència', async () => {
    User.create.mockRejectedValue(new Error(`document-secret ${PASSWORD} ${storedHash}`));
    const res = await request(app).post('/auth/register').send(registration);
    assertError(res, 500);
    expect(res.body.error).toBe('Error intern del servidor');
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(storedHash);
  });
});

describe('#40 login', () => {
  it('crea dues sessions diferents dins del mateix segon, amb el mateix esquema que registre', async () => {
    const registered = await request(app).post('/auth/register').send(registration);
    jest.spyOn(Date, 'now').mockReturnValue(1793020000000);
    const first = await request(app).post('/auth/login').send(credentials);
    const second = await request(app).post('/auth/login').send(credentials);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Object.keys(first.body).sort()).toEqual(Object.keys(registered.body).sort());
    expect(jwt.decode(first.body.token).iat).toBe(jwt.decode(second.body.token).iat);
    expect(jwt.decode(first.body.token).jti).not.toBe(jwt.decode(second.body.token).jti);
  });

  it('si falla la persistència de sessió, no retorna èxit ni token', async () => {
    Session.create.mockRejectedValue(new Error('Mongo unavailable'));
    const res = await request(app).post('/auth/login').send(credentials);
    assertError(res, 500);
    expect(res.body).not.toHaveProperty('token');
  });
  it('retorna el perfil públic i un JWT signat amb identitat i expiració', async () => {
    const res = await request(app).post('/auth/login').send({ ...credentials, email: 'PROVA@EXAMPLE.CAT' });
    expect(res.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ email: credentials.email });
    expect(res.body).toMatchObject({ user: { id: ID, email: credentials.email }, tokenType: 'Bearer', expiresIn: 3600 });
    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'id', 'preferences', 'username']);
    const payload = jwt.verify(res.body.token, SECRET, { algorithms: ['HS256'], issuer: 'caliu-api', audience: 'caliu-android' });
    expect(payload).toMatchObject({ sub: ID, jti: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(Session.create).toHaveBeenCalledWith({ userId: ID, jti: payload.jti, expiresAt: new Date(payload.exp * 1000) });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('dona el mateix 401 per usuari inexistent i password erroni', async () => {
    const wrong = await request(app).post('/auth/login').send({ ...credentials, password: 'Una-altra-contrasenya' });
    User.findOne.mockReturnValue({ select: async () => null });
    const missing = await request(app).post('/auth/login').send(credentials);
    assertError(wrong, 401);
    assertError(missing, 401);
    expect(wrong.body).toEqual(missing.body);
  });

  it('valida la petició abans de consultar Mongo', async () => {
    const res = await request(app).post('/auth/login').send({ email: { $ne: null }, password: PASSWORD });
    assertError(res, 400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('respecta la durada configurada', async () => {
    process.env.JWT_TTL_SECONDS = '900';
    const res = await request(app).post('/auth/login').send(credentials);
    expect(res.body.expiresIn).toBe(900);
    const payload = jwt.verify(res.body.token, SECRET);
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('no emet tokens si falta configuració segura', async () => {
    delete process.env.JWT_SECRET;
    const res = await request(app).post('/auth/login').send(credentials);
    assertError(res, 500);
    expect(res.body).not.toHaveProperty('token');
  });

  it.each(['', '0', '-1', '1h', '86401', 'Infinity'])('rebutja JWT_TTL_SECONDS=%s', (ttl) => {
    process.env.JWT_TTL_SECONDS = ttl;
    expect(() => getAuthConfig()).toThrow('JWT_TTL_SECONDS');
  });

  it('retorna 500 coherent si falla MongoDB', async () => {
    User.findOne.mockReturnValue({ select: async () => { throw new Error('Mongo unavailable'); } });
    assertError(await request(app).post('/auth/login').send(credentials), 500);
  });
});

describe('middleware Bearer JWT (a través de logout)', () => {
  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer abc', 'Bearer a b'])('rebutja Authorization invàlid %#', async (header) => {
    const req = request(app).post('/auth/logout');
    if (header !== undefined) req.set('Authorization', header);
    assertError(await req, 401);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it.each([
    () => token({}, { expiresIn: -1 }),
    () => token({}, { algorithm: 'HS384' }),
    () => token({}, { audience: 'other' }),
    () => token({}, { issuer: 'other' }),
    () => token({}, { notBefore: '1h' }),
    () => token({}, { subject: 'not-an-objectid' }),
    () => token({ jti: -1 }),
    () => token({ jti: 'invalid' }),
    () => jwt.sign({ sub: ID, tokenVersion: 0, iss: 'caliu-api', aud: 'caliu-android' }, SECRET),
    () => jwt.sign({ sub: ID, exp: Math.floor(Date.now() / 1000) + 60, iss: 'caliu-api', aud: 'caliu-android' }, SECRET),
    () => jwt.sign({ sub: ID, tokenVersion: 0 }, 'wrong-key', { expiresIn: 3600 }),
  ])('rebutja tokens expirats, claims o signatura invàlids %#', async (makeToken) => {
    assertError(await request(app).post('/auth/logout').auth(makeToken(), { type: 'bearer' }), 401);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('rebutja usuaris eliminats i sessions absents', async () => {
    User.findById.mockReturnValue({ lean: async () => null });
    assertError(await request(app).post('/auth/logout').auth(token(), { type: 'bearer' }), 401);
    User.findById.mockReturnValue({ lean: async () => user });
    Session.exists.mockResolvedValue(null);
    assertError(await request(app).post('/auth/logout').auth(token(), { type: 'bearer' }), 401);
  });

  it('retorna 500 si falla la consulta de sessió', async () => {
    Session.exists.mockRejectedValue(new Error('Mongo unavailable'));
    assertError(await request(app).post('/auth/logout').auth(token(), { type: 'bearer' }), 500);
  });

  it('la consulta de sessió comprova propietari i expiració sense confiar en el TTL', async () => {
    const res = await request(app).post('/auth/logout').auth(token(), { type: 'bearer' });
    expect(res.status).toBe(204);
    expect(Session.exists).toHaveBeenCalledWith({ userId: ID, jti: JTI, expiresAt: { $gt: expect.any(Date) } });
  });

  it('no concedeix accés si falla la consulta de l’usuari', async () => {
    User.findById.mockReturnValue({ lean: async () => { throw new Error('Mongo unavailable'); } });
    assertError(await request(app).get('/users/me').auth(token(), { type: 'bearer' }), 500);
    expect(Session.exists).not.toHaveBeenCalled();
  });
});

describe('JSON malformat', () => {
  it('no retorna el cos original ni el parser error', async () => {
    const res = await request(app).post('/auth/register').set('Content-Type', 'application/json').send('{"password":"private",broken');
    assertError(res, 400);
    expect(res.body).toEqual({ error: 'JSON no vàlid' });
  });
});
