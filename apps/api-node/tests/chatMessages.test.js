import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import Session from '../src/models/Session.js';
import SessioXatbot from '../src/models/SessioXatbot.js';
import MissatgeXatbot from '../src/models/MissatgeXatbot.js';
import User from '../src/models/User.js';
import { chatRateLimiter } from '../src/middlewares/chatRateLimit.js';

const proxyToPython = jest.fn();
jest.unstable_mockModule('../src/integrations/pythonService.js', () => ({ proxyToPython }));
const { default: app } = await import('../src/app.js');

const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
const OTHER_USER_ID = '64b7f0c2a1b2c3d4e5f60719';
const CHAT_SESSION_ID = '64b7f0c2a1b2c3d4e5f60720';
const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;
let token;
let validSessions;

function createToken(userId = USER_ID) {
  const jti = randomBytes(32).toString('hex');
  validSessions.add(jti);
  return jwt.sign({ jti }, SECRET, {
    subject: userId,
    algorithm: 'HS256',
    issuer: 'caliu-api',
    audience: 'caliu-android',
    expiresIn: 3600,
  });
}

const auth = (req) => req.auth(token, { type: 'bearer' });

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_TTL_SECONDS = '3600';
  validSessions = new Set();
  token = createToken();
  chatRateLimiter.resetKey(USER_ID);

  jest.spyOn(User, 'findById').mockImplementation((id) => ({
    lean: async () => (id === USER_ID ? { _id: USER_ID } : null),
  }));
  jest.spyOn(Session, 'exists').mockImplementation(async ({ jti, userId }) => (
    String(userId) === USER_ID && validSessions.has(jti) ? { _id: 'auth-session' } : null
  ));
  jest.spyOn(SessioXatbot, 'create').mockImplementation(async (values) => ({
    _id: CHAT_SESSION_ID,
    ...values,
  }));
  jest.spyOn(SessioXatbot, 'findOne').mockImplementation(async ({ _id, userId }) => (
    _id === CHAT_SESSION_ID && String(userId) === USER_ID
      ? { _id: CHAT_SESSION_ID, userId: USER_ID }
      : null
  ));
  jest.spyOn(MissatgeXatbot, 'create').mockImplementation(async (values) => values);
  jest.spyOn(MissatgeXatbot, 'find').mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  });
  proxyToPython.mockReset().mockResolvedValue({ reply: 'Et recomano un concert.' });
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTtl === undefined) delete process.env.JWT_TTL_SECONDS;
  else process.env.JWT_TTL_SECONDS = originalTtl;
});

describe('POST /chat/messages', () => {
  it('creates a chat session, stores both messages, and proxies to Python', async () => {
    const res = await auth(request(app).post('/chat/messages').send({ message: '  plans per avui?  ' }));

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ sessionId: CHAT_SESSION_ID, type: 'text', reply: 'Et recomano un concert.' });
    expect(SessioXatbot.create).toHaveBeenCalledWith({ userId: USER_ID });
    expect(MissatgeXatbot.create).toHaveBeenNthCalledWith(1, {
      sessionId: CHAT_SESSION_ID,
      role: 'user',
      content: 'plans per avui?',
    });
    expect(proxyToPython).toHaveBeenCalledWith({
      path: '/chat/messages',
      token: token,
      body: { message: 'plans per avui?', history: [] },
    });
    expect(MissatgeXatbot.create).toHaveBeenNthCalledWith(2, {
      sessionId: CHAT_SESSION_ID,
      role: 'assistant',
      content: 'Et recomano un concert.',
    });
  });

  it('returns the plan of an itinerary and stores its text in the history (#140)', async () => {
    const plan = {
      date: '2026-11-21',
      steps: [{ order: 1, id: 'a', title: 'Visita guiada al Call', start: '2026-11-21T10:30:00+01:00' }],
    };
    proxyToPython.mockResolvedValueOnce({ type: 'plan', reply: 'Aquí tens un itinerari…', plan, language: 'ca' });

    const res = await auth(request(app).post('/chat/messages').send({ message: 'fes-me un itinerari' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: CHAT_SESSION_ID, type: 'plan', reply: 'Aquí tens un itinerari…', plan });
    expect(MissatgeXatbot.create).toHaveBeenNthCalledWith(2, {
      sessionId: CHAT_SESSION_ID,
      role: 'assistant',
      content: 'Aquí tens un itinerari…',
    });
  });

  it.each([
    { type: 'plan', reply: 'Text', plan: { steps: [] } },
    { type: 'plan', reply: 'Text', plan: { steps: 'no' } },
    { type: 'plan', reply: 'Text' },
    { type: 'altre', reply: 'Text', plan: { steps: [{ order: 1 }] } },
  ])('treats an invalid plan as a text answer %#', async (result) => {
    proxyToPython.mockResolvedValueOnce(result);
    const res = await auth(request(app).post('/chat/messages').send({ message: 'itinerari' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: CHAT_SESSION_ID, type: 'text', reply: 'Text' });
  });

  it('uses an existing session only when it belongs to the authenticated user', async () => {
    const res = await auth(request(app).post('/chat/messages').send({
      message: 'teatre',
      sessionId: CHAT_SESSION_ID,
    }));

    expect(res.status).toBe(200);
    expect(SessioXatbot.findOne).toHaveBeenCalledWith({ _id: CHAT_SESSION_ID, userId: USER_ID });
    expect(SessioXatbot.create).not.toHaveBeenCalled();
  });

  it('sends at most the ten latest messages in chronological order', async () => {
    const storedHistory = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: index === 0 ? 'x'.repeat(1500) : `missatge ${10 - index}`,
    }));
    const historyQuery = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(storedHistory),
    };
    jest.spyOn(MissatgeXatbot, 'find').mockReturnValue({
      ...historyQuery,
    });

    const res = await auth(request(app).post('/chat/messages').send({
      message: 'i demà?',
      sessionId: CHAT_SESSION_ID,
    }));

    expect(res.status).toBe(200);
    expect(MissatgeXatbot.find).toHaveBeenCalledWith({ sessionId: CHAT_SESSION_ID });
    expect(historyQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(historyQuery.limit).toHaveBeenCalledWith(10);
    const sentHistory = proxyToPython.mock.calls[0][0].body.history;
    expect(sentHistory).toEqual([...storedHistory].reverse().map(({ role, content }) => ({
      role,
      content: content.slice(0, 1000),
    })));
    expect(MissatgeXatbot.create.mock.invocationCallOrder[0])
      .toBeGreaterThan(proxyToPython.mock.invocationCallOrder[0]);
  });

  it('rejects unknown or malformed chat sessions', async () => {
    const notOwned = await auth(request(app).post('/chat/messages').send({
      message: 'teatre',
      sessionId: '64b7f0c2a1b2c3d4e5f60721',
    }));
    const malformed = await auth(request(app).post('/chat/messages').send({
      message: 'teatre',
      sessionId: 'no-es-un-id',
    }));

    expect(notOwned.status).toBe(404);
    expect(notOwned.body).toEqual({ error: 'Sessió de xat no trobada' });
    expect(malformed.status).toBe(400);
    expect(proxyToPython).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { message: '  ' },
    { message: 'x'.repeat(501) },
    { message: 'hola', userId: OTHER_USER_ID },
  ])('validates message input before creating chat data', async (body) => {
    const res = await auth(request(app).post('/chat/messages').send(body));

    expect(res.status).toBe(400);
    expect(SessioXatbot.create).not.toHaveBeenCalled();
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
    expect(proxyToPython).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/chat/messages').send({ message: 'teatre' });

    expect(res.status).toBe(401);
    expect(SessioXatbot.create).not.toHaveBeenCalled();
  });

  it('does not create a session or store messages if Python fails', async () => {
    proxyToPython.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 502 }));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

    expect(res.status).toBe(502);
    expect(SessioXatbot.create).not.toHaveBeenCalled();
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
  });

  it('limits requests per authenticated user', async () => {
    const responses = [];
    for (let i = 0; i < 11; i += 1) {
      responses.push(await auth(request(app).post('/chat/messages').send({ message: 'teatre' })));
    }

    expect(responses.slice(0, 10).every((res) => res.status === 200)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(responses[10].body).toEqual({
      error: 'Has arribat al límit de missatges; torna-ho a provar més tard',
    });
    expect(proxyToPython).toHaveBeenCalledTimes(10);
  });
});
