import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import Session from '../src/models/Session.js';
import SessioXatbot from '../src/models/SessioXatbot.js';
import MissatgeXatbot from '../src/models/MissatgeXatbot.js';
import User from '../src/models/User.js';
import { chatRateLimiter } from '../src/middlewares/chatRateLimit.js';
import { httpError } from '../src/domain/httpError.js';

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
  jest.spyOn(SessioXatbot, 'updateOne').mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(MissatgeXatbot, 'create').mockImplementation(async (values) => values);
  jest.spyOn(MissatgeXatbot, 'find').mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  });
  proxyToPython.mockReset().mockResolvedValue({
    reply: 'Et recomano un concert.',
    events: [{ id: 'event-1', title: 'Concert de prova' }],
  });
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
    expect(res.body).toEqual({
      sessionId: CHAT_SESSION_ID,
      type: 'text',
      reply: 'Et recomano un concert.',
      events: [{ id: 'event-1', title: 'Concert de prova' }],
      filters: null,
    });
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
    expect(res.body).toEqual({
      sessionId: CHAT_SESSION_ID, type: 'plan', reply: 'Aquí tens un itinerari…', events: [], filters: null, plan,
    });
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
    expect(res.body).toEqual({ sessionId: CHAT_SESSION_ID, type: 'text', reply: 'Text', events: [], filters: null });
  });

  it('returns the fallback answer without storing it, so the message can be sent again (#142)', async () => {
    proxyToPython.mockResolvedValueOnce({ type: 'fallback', reply: 'Ara mateix no puc respondre…', language: 'ca' });

    const res = await auth(request(app).post('/chat/messages').send({ message: 'plans per avui?' }));

    expect(res.status).toBe(200);
    // Conversa nova: no es crea cap sessió buida.
    expect(res.body).toEqual({
      sessionId: null, type: 'fallback', reply: 'Ara mateix no puc respondre…', events: [], filters: null,
    });
    expect(SessioXatbot.create).not.toHaveBeenCalled();
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
  });

  it('keeps the existing session on a fallback answer', async () => {
    proxyToPython.mockResolvedValueOnce({ type: 'fallback', reply: 'Ara mateix no puc respondre…' });

    const res = await auth(request(app).post('/chat/messages').send({ message: 'i demà?', sessionId: CHAT_SESSION_ID }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionId: CHAT_SESSION_ID, type: 'fallback', reply: 'Ara mateix no puc respondre…', events: [], filters: null,
    });
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
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
    expect(notOwned.body).toEqual({ error: 'Sessió de xat no trobada', code: 'SESSION_NOT_FOUND' });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: 'Camp "sessionId" no vàlid', code: 'INVALID_SESSION_ID' });
    expect(proxyToPython).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'MESSAGE_REQUIRED'],
    [{ message: '  ' }, 'MESSAGE_REQUIRED'],
    [{ message: 42 }, 'MESSAGE_REQUIRED'],
    [{ message: 'x'.repeat(501) }, 'MESSAGE_TOO_LONG'],
    [{ message: 'hola', userId: OTHER_USER_ID }, 'INVALID_BODY'],
    [{ message: 'hola', locale: 'fr' }, 'INVALID_LOCALE'],
    [{ message: 'hola', locale: 3 }, 'INVALID_LOCALE'],
  ])('validates message input before creating chat data %#', async (body, code) => {
    const res = await auth(request(app).post('/chat/messages').send(body));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String), code });
    expect(SessioXatbot.create).not.toHaveBeenCalled();
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
    expect(proxyToPython).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/chat/messages').send({ message: 'teatre' });

    expect(res.status).toBe(401);
    expect(SessioXatbot.create).not.toHaveBeenCalled();
  });

  it.each([
    [503, 'CHATBOT_UNAVAILABLE', 'El servei de xatbot no està disponible'],
    [503, 'EVENTS_UNAVAILABLE', 'El servei d\'esdeveniments no està disponible'],
    [504, 'CHATBOT_TIMEOUT', 'El servei de xatbot ha tardat massa a respondre'],
    [502, 'CHATBOT_ERROR', 'El servei de xatbot ha fallat'],
  ])('returns %i %s with its message so the app can offer a retry (#143)', async (status, code, error) => {
    proxyToPython.mockRejectedValueOnce(httpError(status, error, code));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error, code });
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
  });

  it('returns CHATBOT_INVALID_RESPONSE if Python answers without text', async () => {
    proxyToPython.mockResolvedValueOnce({ reply: '  ' });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Resposta del servei de xatbot no vàlida', code: 'CHATBOT_INVALID_RESPONSE' });
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
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

  it('returns an empty events list when Python does not provide events', async () => {
    proxyToPython.mockResolvedValueOnce({ reply: 'Et recomano un concert.' });

    const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionId: CHAT_SESSION_ID,
      type: 'text',
      reply: 'Et recomano un concert.',
      events: [],
      filters: null,
    });
    expect(SessioXatbot.create).toHaveBeenCalledWith({ userId: USER_ID });
    expect(MissatgeXatbot.create).toHaveBeenCalledTimes(2);
  });

  it('forwards the app locale to Python', async () => {
    const res = await auth(request(app).post('/chat/messages').send({ message: 'ok', locale: 'es' }));

    expect(res.status).toBe(200);
    expect(proxyToPython).toHaveBeenCalledWith({
      path: '/chat/messages',
      token: token,
      body: { message: 'ok', history: [], locale: 'es' },
    });
  });

  it('returns the filters interpreted by Python', async () => {
    const filters = {
      from: '2026-11-18T15:00:00+01:00',
      to: '2026-11-18T20:00:00+01:00',
      timeOfDay: 'tarda',
      categories: [],
      audience: 'infantil',
      maxPrice: 0,
    };
    proxyToPython.mockResolvedValueOnce({ reply: 'Et recomano un taller.', events: [], filters });

    const res = await auth(request(app).post('/chat/messages').send({ message: 'nens a la tarda' }));

    expect(res.status).toBe(200);
    expect(res.body.filters).toEqual(filters);
  });

  it('ignores malformed filters from Python', async () => {
    proxyToPython.mockResolvedValueOnce({ reply: 'Et recomano un taller.', events: [], filters: ['tarda'] });

    const res = await auth(request(app).post('/chat/messages').send({ message: 'nens a la tarda' }));

    expect(res.status).toBe(200);
    expect(res.body.filters).toBeNull();
  });

  it('rejects a Python response with an invalid reply', async () => {
    proxyToPython.mockResolvedValueOnce({ reply: '  ', events: [] });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

    expect(res.status).toBe(502);
    // #143: l'error porta el seu codi i un missatge propi en lloc del genèric.
    expect(res.body).toEqual({ error: 'Resposta del servei de xatbot no vàlida', code: 'CHATBOT_INVALID_RESPONSE' });
    expect(SessioXatbot.create).not.toHaveBeenCalled();
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
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
      code: 'RATE_LIMITED',
    });
    expect(proxyToPython).toHaveBeenCalledTimes(10);
  });
});

describe('POST /chat/sessions (#161)', () => {
  const CREATED_AT = new Date('2026-11-23T10:00:00.000Z');

  beforeEach(() => {
    SessioXatbot.create.mockImplementation(async (values) => ({
      _id: CHAT_SESSION_ID,
      createdAt: CREATED_AT,
      ...values,
    }));
  });

  it('creates an empty session for the authenticated user', async () => {
    const res = await auth(request(app).post('/chat/sessions'));

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ sessionId: CHAT_SESSION_ID, createdAt: CREATED_AT.toISOString() });
    expect(SessioXatbot.create).toHaveBeenCalledWith({ userId: USER_ID });
    expect(MissatgeXatbot.create).not.toHaveBeenCalled();
    expect(proxyToPython).not.toHaveBeenCalled();
  });

  it('accepts an empty JSON body', async () => {
    const res = await auth(request(app).post('/chat/sessions').send({}));

    expect(res.status).toBe(201);
  });

  it.each([
    ['another user id', { userId: OTHER_USER_ID }],
    ['an unknown field', { title: 'Nova conversa' }],
    ['an array', []],
  ])('rejects a body with %s', async (_name, body) => {
    const res = await auth(request(app).post('/chat/sessions').send(body));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Cos de la petició no vàlid', code: 'INVALID_BODY' });
    expect(SessioXatbot.create).not.toHaveBeenCalled();
  });

  it('requires a valid JWT', async () => {
    const missing = await request(app).post('/chat/sessions');
    const invalid = await request(app).post('/chat/sessions').auth('no-es-un-jwt', { type: 'bearer' });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(SessioXatbot.create).not.toHaveBeenCalled();
  });

  it('returns 500 without internal details if the session cannot be stored', async () => {
    SessioXatbot.create.mockRejectedValueOnce(new Error('mongodb://user:secret@host'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await auth(request(app).post('/chat/sessions'));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
  });

  it('starts the new session without the history of previous ones', async () => {
    const { body: { sessionId } } = await auth(request(app).post('/chat/sessions'));

    const res = await auth(request(app).post('/chat/messages').send({ message: 'I el de dissabte?', sessionId }));

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(sessionId);
    expect(MissatgeXatbot.find).toHaveBeenCalledWith({ sessionId });
    expect(proxyToPython).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ history: [] }),
    }));
    expect(SessioXatbot.create).toHaveBeenCalledTimes(1);
  });
});

describe('historial del xat (#163)', () => {
  const OLDER_SESSION_ID = '64b7f0c2a1b2c3d4e5f60721';
  const query = (result) => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result),
    };
    return chain;
  };

  describe('GET /chat/sessions', () => {
    it('lists only the sessions of the authenticated user, most recent first', async () => {
      const sessions = query([
        {
          _id: CHAT_SESSION_ID,
          title: 'plans per avui?',
          createdAt: new Date('2026-11-23T09:00:00.000Z'),
          lastActivityAt: new Date('2026-11-23T10:00:00.000Z'),
        },
        { _id: OLDER_SESSION_ID, createdAt: new Date('2026-11-22T09:00:00.000Z'), updatedAt: new Date('2026-11-22T09:00:00.000Z') },
      ]);
      const find = jest.spyOn(SessioXatbot, 'find').mockReturnValue(sessions);

      const res = await auth(request(app).get('/chat/sessions?userId=' + OTHER_USER_ID));

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(find).toHaveBeenCalledWith({ userId: USER_ID });
      expect(sessions.sort).toHaveBeenCalledWith({ lastActivityAt: -1, _id: -1 });
      expect(res.body).toEqual({
        items: [
          {
            id: CHAT_SESSION_ID,
            title: 'plans per avui?',
            createdAt: '2026-11-23T09:00:00.000Z',
            lastActivityAt: '2026-11-23T10:00:00.000Z',
          },
          // Sessió buida o antiga, sense títol ni lastActivityAt: l'app pot mostrar-la com a "Nova conversa".
          {
            id: OLDER_SESSION_ID,
            title: null,
            createdAt: '2026-11-22T09:00:00.000Z',
            lastActivityAt: '2026-11-22T09:00:00.000Z',
          },
        ],
      });
    });

    it('returns an empty list when the user has no sessions', async () => {
      jest.spyOn(SessioXatbot, 'find').mockReturnValue(query([]));

      const res = await auth(request(app).get('/chat/sessions'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });
  });

  describe('GET /chat/sessions/:id/messages', () => {
    const path = `/chat/sessions/${CHAT_SESSION_ID}/messages`;

    it('returns the messages of an own session in chronological order', async () => {
      const exists = jest.spyOn(SessioXatbot, 'exists').mockResolvedValue({ _id: CHAT_SESSION_ID });
      const messages = query([
        { _id: 'm1', role: 'user', content: 'plans per avui?', createdAt: new Date('2026-11-23T10:00:00.000Z') },
        { _id: 'm2', role: 'assistant', content: 'Et recomano un concert.', createdAt: new Date('2026-11-23T10:00:01.000Z') },
      ]);
      const find = jest.spyOn(MissatgeXatbot, 'find').mockReturnValue(messages);

      const res = await auth(request(app).get(path));

      expect(res.status).toBe(200);
      expect(exists).toHaveBeenCalledWith({ _id: CHAT_SESSION_ID, userId: USER_ID });
      expect(find).toHaveBeenCalledWith({ sessionId: CHAT_SESSION_ID });
      expect(messages.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
      expect(res.body).toEqual({
        items: [
          { id: 'm1', role: 'user', content: 'plans per avui?', createdAt: '2026-11-23T10:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: 'Et recomano un concert.', createdAt: '2026-11-23T10:00:01.000Z' },
        ],
      });
    });

    it('returns an empty list for an own session without messages', async () => {
      jest.spyOn(SessioXatbot, 'exists').mockResolvedValue({ _id: CHAT_SESSION_ID });
      jest.spyOn(MissatgeXatbot, 'find').mockReturnValue(query([]));

      const res = await auth(request(app).get(path));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it("rejects another user's session as not found, without reading its messages", async () => {
      jest.spyOn(SessioXatbot, 'exists').mockResolvedValue(null);
      const find = jest.spyOn(MissatgeXatbot, 'find');

      const res = await auth(request(app).get(`/chat/sessions/${OLDER_SESSION_ID}/messages`));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Sessió de xat no trobada', code: 'SESSION_NOT_FOUND' });
      expect(find).not.toHaveBeenCalled();
    });

    it.each(['no-es-un-id', 'aaaaaaaaaaaa'])('rejects a malformed session id (%s)', async (id) => {
      const exists = jest.spyOn(SessioXatbot, 'exists');

      const res = await auth(request(app).get(`/chat/sessions/${id}/messages`));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Identificador de sessió no vàlid', code: 'INVALID_SESSION_ID' });
      expect(exists).not.toHaveBeenCalled();
    });
  });

  it.each([
    '/chat/sessions',
    `/chat/sessions/${CHAT_SESSION_ID}/messages`,
  ])('GET %s requires a valid JWT', async (path) => {
    const find = jest.spyOn(SessioXatbot, 'find');
    const missing = await request(app).get(path);
    const invalid = await request(app).get(path).auth('no-es-un-jwt', { type: 'bearer' });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(find).not.toHaveBeenCalled();
  });

  it('returns 500 without internal details if the history cannot be read', async () => {
    jest.spyOn(SessioXatbot, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockRejectedValue(new Error('mongodb://user:secret@host')),
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await auth(request(app).get('/chat/sessions'));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
  });

  it('does not count history requests in the chat rate limit', async () => {
    jest.spyOn(SessioXatbot, 'find').mockReturnValue(query([]));
    for (let i = 0; i < 12; i += 1) {
      expect((await auth(request(app).get('/chat/sessions'))).status).toBe(200);
    }

    const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

    expect(res.status).toBe(200);
  });

  describe('updates the session when messages are stored', () => {
    it('moves the session to the top and keeps the first message as title', async () => {
      await auth(request(app).post('/chat/messages').send({ message: '  plans per avui?  ' }));

      expect(SessioXatbot.updateOne).toHaveBeenCalledWith({ _id: CHAT_SESSION_ID }, [
        { $set: { lastActivityAt: expect.any(Date), title: { $ifNull: ['$title', { $literal: 'plans per avui?' }] } } },
      ]);
    });

    it('cuts the title to 80 characters without splitting emojis', async () => {
      const message = `${'🎭'.repeat(79)}ab`;

      await auth(request(app).post('/chat/messages').send({ message }));

      const [, [{ $set }]] = SessioXatbot.updateOne.mock.calls[0];
      expect($set.title.$ifNull[1].$literal).toBe(`${'🎭'.repeat(79)}a`);
    });

    it('does not touch the session on a fallback answer', async () => {
      proxyToPython.mockResolvedValueOnce({ type: 'fallback', reply: 'Ara no puc respondre.' });

      await auth(request(app).post('/chat/messages').send({ message: 'teatre', sessionId: CHAT_SESSION_ID }));

      expect(SessioXatbot.updateOne).not.toHaveBeenCalled();
    });

    it('still answers if the session cannot be updated', async () => {
      SessioXatbot.updateOne.mockRejectedValueOnce(new Error('mongo'));
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await auth(request(app).post('/chat/messages').send({ message: 'teatre' }));

      expect(res.status).toBe(200);
      expect(MissatgeXatbot.create).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith('No s’ha pogut actualitzar la sessió de xat');
    });
  });
});
