import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';
import app from '../src/app.js';
import { getAuthConfig } from '../src/config/auth.js';

// Només dades sintètiques i models simulats: cap connexió MongoDB.
const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const PASSWORD = 'Contrasenya-de-prova-42';
const ID = '64b7f0c2a1b2c3d4e5f60718';
let user;
let storedHash;
const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;

beforeAll(async () => { storedHash = await bcrypt.hash(PASSWORD, 12); });
beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_TTL_SECONDS = '3600';
  user = { _id: ID, email: 'prova@example.cat', username: null, preferences: [],
    tokenVersion: 0, passwordHash: storedHash };
  jest.spyOn(User, 'create').mockImplementation(async (data) => ({ ...user, ...data }));
  jest.spyOn(User, 'findOne').mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
  jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ lean: async () => user }) });
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
function token(payload = {}, options = {}) {
  return jwt.sign({ tokenVersion: 0, ...payload }, SECRET, {
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
  it('crea un usuari, normalitza el correu i desa bcrypt amb salt i cost 12', async () => {
    const res = await request(app).post('/auth/register').send({ ...credentials, email: '  PROVA@EXAMPLE.CAT ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ user: { id: ID, email: credentials.email, username: null, preferences: [] } });
    expect(res.headers['cache-control']).toBe('no-store');
    const data = User.create.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['email', 'passwordHash']);
    expect(data.email).toBe(credentials.email);
    expect(data.passwordHash).not.toBe(PASSWORD);
    expect(bcrypt.getRounds(data.passwordHash)).toBe(12);
    expect(await bcrypt.compare(PASSWORD, data.passwordHash)).toBe(true);
    expect(data.passwordHash).not.toBe(storedHash); // salt diferent per al mateix password
  });

  it.each([
    {}, { email: credentials.email }, { ...credentials, email: null },
    { ...credentials, email: { $ne: null } }, { ...credentials, email: 'a..b@example.cat' },
    { ...credentials, email: 'a@-bad.cat' }, { ...credentials, email: 'a@localhost' },
    { ...credentials, email: `${'a'.repeat(65)}@example.cat` },
    { ...credentials, password: 12345678 }, { ...credentials, password: 'curta' },
    { ...credentials, password: 'a'.repeat(73) }, { ...credentials, password: 'é'.repeat(37) },
    { ...credentials, password: '        ' }, { ...credentials, password: 'password\n' },
    { ...credentials, role: 'admin' }, { ...credentials, username: 'nom' }, [],
  ])('rebutja entrada invàlida %# sense escriure a Mongo', async (body) => {
    const res = await request(app).post('/auth/register').send(body);
    assertError(res, 400);
    expect(User.create).not.toHaveBeenCalled();
  });

  it('retorna 409 per duplicat d’índex únic (inclosa la cursa entre registres)', async () => {
    User.create.mockRejectedValue(Object.assign(new Error('document amb secrets'), { code: 11000 }));
    const res = await request(app).post('/auth/register').send(credentials);
    assertError(res, 409);
    expect(res.body.error).toBe('El correu ja està registrat');
  });

  it('retorna 500 genèric i no imprimeix dades de persistència', async () => {
    User.create.mockRejectedValue(new Error(`document-secret ${PASSWORD} ${storedHash}`));
    const res = await request(app).post('/auth/register').send(credentials);
    assertError(res, 500);
    expect(res.body.error).toBe('Error intern del servidor');
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(storedHash);
  });
});

describe('#40 login', () => {
  it('retorna el perfil públic i un JWT signat amb identitat i expiració', async () => {
    const res = await request(app).post('/auth/login').send({ ...credentials, email: 'PROVA@EXAMPLE.CAT' });
    expect(res.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ email: credentials.email });
    expect(res.body).toMatchObject({ user: { id: ID, email: credentials.email }, tokenType: 'Bearer', expiresIn: 3600 });
    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'id', 'preferences', 'username']);
    const payload = jwt.verify(res.body.token, SECRET, { algorithms: ['HS256'], issuer: 'caliu-api', audience: 'caliu-android' });
    expect(payload).toMatchObject({ sub: ID, tokenVersion: 0 });
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
    () => token({ tokenVersion: -1 }),
    () => token({ tokenVersion: '0' }),
    () => jwt.sign({ sub: ID, tokenVersion: 0, iss: 'caliu-api', aud: 'caliu-android' }, SECRET),
    () => jwt.sign({ sub: ID, exp: Math.floor(Date.now() / 1000) + 60, iss: 'caliu-api', aud: 'caliu-android' }, SECRET),
    () => jwt.sign({ sub: ID, tokenVersion: 0 }, 'wrong-key', { expiresIn: 3600 }),
  ])('rebutja tokens expirats, claims o signatura invàlids %#', async (makeToken) => {
    assertError(await request(app).post('/auth/logout').auth(makeToken(), { type: 'bearer' }), 401);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('rebutja usuaris eliminats i versions de sessió antigues', async () => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => null }) });
    assertError(await request(app).post('/auth/logout').auth(token(), { type: 'bearer' }), 401);
    User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ ...user, tokenVersion: 1 }) }) });
    assertError(await request(app).post('/auth/logout').auth(token(), { type: 'bearer' }), 401);
  });

  it('retorna 500 si falla la consulta de sessió', async () => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => { throw new Error('Mongo unavailable'); } }) });
    assertError(await request(app).post('/auth/logout').auth(token(), { type: 'bearer' }), 500);
  });
});

describe('JSON malformat', () => {
  it('no retorna el cos original ni el parser error', async () => {
    const res = await request(app).post('/auth/register').set('Content-Type', 'application/json').send('{"password":"private",broken');
    assertError(res, 400);
    expect(res.body).toEqual({ error: 'JSON no vàlid' });
  });
});
