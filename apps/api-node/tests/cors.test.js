import express from 'express';
import request from 'supertest';
import { createCors, parseOrigins } from '../src/middlewares/cors.js';

const ALLOWED = 'http://localhost:5000';

function buildApp(origins) {
  const app = express();
  app.use(createCors(origins));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('parseOrigins', () => {
  it('separa per comes, treu espais i barres finals', () => {
    expect(parseOrigins(' http://localhost:5000/ , https://a.github.io ,')).toEqual([
      'http://localhost:5000',
      'https://a.github.io',
    ]);
  });

  it('sense valor retorna una llista buida', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('')).toEqual([]);
  });
});

describe('middleware CORS', () => {
  const app = buildApp([ALLOWED]);

  it('afegeix Access-Control-Allow-Origin per a un origen permès', async () => {
    const res = await request(app).get('/ping').set('Origin', ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('no afegeix capçaleres per a un origen no permès', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('no fa res sense capçalera Origin (app Android, curl)', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('respon el preflight OPTIONS amb 204 i els mètodes i capçaleres', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'Authorization,Content-Type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('sense orígens configurats queda desactivat', async () => {
    const res = await request(buildApp([])).get('/ping').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
