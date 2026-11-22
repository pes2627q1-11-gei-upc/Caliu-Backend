import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import app from '../src/app.js';
import User from '../src/models/User.js';

afterEach(() => jest.restoreAllMocks());

it('emet un codi opac, el consumeix atòmicament i rebutja la reutilització', async () => {
  process.env.RESEND_API_KEY = 'test';
  process.env.RESET_EMAIL_FROM = 'test@example.cat';
  const mail = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
  const update = jest.spyOn(User, 'updateOne').mockResolvedValue({ matchedCount: 1 });
  const forgot = () => request(app).post('/auth/forgot-password').send({ email: 'Test@example.cat' });
  expect((await forgot()).status).toBe(202);
  const [url, options] = mail.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails');
  const code = JSON.parse(options.body).text.match(/[a-f0-9]{48}/)[0];
  const digest = createHash('sha256').update(code).digest('hex');
  expect(update.mock.calls[0][1].$set.resetDigest).toBe(digest);
  const reset = () => request(app).post('/auth/reset-password').send({ token: code, password: 'nova-clau-segura' });
  expect((await reset()).status).toBe(204);
  const [filter, mutation] = update.mock.calls[1];
  expect(filter).toEqual({ resetDigest: digest, resetExpiresAt: { $gt: expect.any(Date) } });
  expect(mutation.$unset).toEqual({ resetDigest: '', resetExpiresAt: '' });
  expect(await bcrypt.compare('nova-clau-segura', mutation.$set.passwordHash)).toBe(true);
  update.mockResolvedValue({ matchedCount: 0 });
  expect((await reset()).status).toBe(400);
  expect((await forgot()).status).toBe(202);
  expect(mail).toHaveBeenCalledTimes(1);
  delete process.env.RESEND_API_KEY;
  delete process.env.RESET_EMAIL_FROM;
});
