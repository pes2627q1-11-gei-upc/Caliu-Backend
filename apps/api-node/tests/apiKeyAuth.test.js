import express from 'express';
import request from 'supertest';
import { createApiKeyAuth, parseApiKeys } from '../src/middlewares/apiKeyAuth.js';

const KEY = 'k'.repeat(32);
const OTHER_KEY = 'o'.repeat(40);

function buildApp(middleware) {
  const app = express();
  app.use(middleware);
  app.get('/ping', (req, res) => res.json({ client: req.apiClient }));
  return app;
}

describe('#212 parseApiKeys', () => {
  it('llegeix parelles nom:clau separades per comes i treu espais', () => {
    const clients = parseApiKeys(` xematrip:${KEY} , altre:${OTHER_KEY} ,`);
    expect([...clients.keys()]).toEqual(['xematrip', 'altre']);
  });

  it('sense valor no hi ha cap client', () => {
    expect(parseApiKeys(undefined).size).toBe(0);
    expect(parseApiKeys('').size).toBe(0);
  });

  it.each([KEY, `:${KEY}`, 'xematrip:curta', `xema trip:${KEY}`, `xematrip:${KEY},xematrip:${OTHER_KEY}`])(
    'rebutja la configuració %p',
    (value) => {
      expect(() => parseApiKeys(value)).toThrow(/EXTERNAL_API_KEYS/);
    },
  );
});

describe('#212 middleware de clau d\'API', () => {
  const app = buildApp(createApiKeyAuth(parseApiKeys(`xematrip:${KEY},altre:${OTHER_KEY}`)));

  it('deixa passar una clau vàlida i identifica el client', async () => {
    const res = await request(app).get('/ping').set('X-API-Key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ client: 'xematrip' });
    expect((await request(app).get('/ping').set('X-API-Key', OTHER_KEY)).body).toEqual({ client: 'altre' });
  });

  it('rebutja amb 401 una petició sense clau', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(['incorrecta', `${KEY}x`, KEY.slice(1), KEY.toUpperCase()])('rebutja amb 401 la clau %p', async (key) => {
    const res = await request(app).get('/ping').set('X-API-Key', key);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Clau d\'API no vàlida' });
  });

  it('sense claus configurades rebutja totes les peticions', async () => {
    const res = await request(buildApp(createApiKeyAuth(parseApiKeys('')))).get('/ping').set('X-API-Key', KEY);
    expect(res.status).toBe(401);
  });

  it('per defecte llegeix les claus d\'EXTERNAL_API_KEYS', async () => {
    const original = process.env.EXTERNAL_API_KEYS;
    process.env.EXTERNAL_API_KEYS = `xematrip:${KEY}`;
    try {
      const res = await request(buildApp(createApiKeyAuth())).get('/ping').set('X-API-Key', KEY);
      expect(res.body).toEqual({ client: 'xematrip' });
    } finally {
      if (original === undefined) delete process.env.EXTERNAL_API_KEYS;
      else process.env.EXTERNAL_API_KEYS = original;
    }
  });
});
