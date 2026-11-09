import request from 'supertest';
import express from 'express';
import { createAuthLimiter, authRateLimitStore } from '../src/middlewares/authRateLimit.js';
import { noStore } from '../src/middlewares/auth.js';
import app from '../src/app.js';

it('limita intents i retorna 429 coherent amb Retry-After sense afectar el perfil', async () => {
  const app = express();
  const limiter = createAuthLimiter({ limit: 2, windowMs: 60000 });
  app.post('/auth/login', noStore, limiter, (_req, res) => res.status(401).json({ error: 'Credencials incorrectes' }));
  app.get('/users/me', (_req, res) => res.sendStatus(200));
  expect((await request(app).post('/auth/login')).status).toBe(401);
  expect((await request(app).post('/auth/login')).status).toBe(401);
  const res = await request(app).post('/auth/login');
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ error: 'Massa intents; torna-ho a provar més tard' });
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  expect(res.headers['cache-control']).toBe('no-store');
  expect((await request(app).get('/users/me')).status).toBe(200);
});

it('register i login comparteixen el límit real abans de validar credencials', async () => {
  authRateLimitStore.resetAll();
  try {
    for (let i = 0; i < 30; i += 1) {
      expect((await request(app).post('/auth/login').send({})).status).toBe(400);
    }
    const blocked = await request(app).post('/auth/register').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Massa intents; torna-ho a provar més tard' });
    expect((await request(app).get('/users/me')).status).toBe(401);
  } finally { authRateLimitStore.resetAll(); }
});
