import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { proxyToPython } from '../src/integrations/pythonService.js';

const SECRET = 'caliu-test-only-secret-with-at-least-32-bytes';
const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
const JTI = 'a'.repeat(64);
const originalSecret = process.env.JWT_SECRET;
const originalTtl = process.env.JWT_TTL_SECONDS;
const originalPythonUrl = process.env.PYTHON_SERVICE_URL;
const originalPythonTimeout = process.env.PYTHON_TIMEOUT_MS;

function token(payload = {}, options = {}) {
  return jwt.sign({ jti: JTI, ...payload }, SECRET, {
    algorithm: 'HS256',
    subject: USER_ID,
    issuer: 'caliu-api',
    audience: 'caliu-android',
    expiresIn: 3600,
    ...options,
  });
}

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_TTL_SECONDS = '3600';
  process.env.PYTHON_SERVICE_URL = 'http://python-service:8000';
  process.env.PYTHON_TIMEOUT_MS = '60000';
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalTtl === undefined) delete process.env.JWT_TTL_SECONDS;
  else process.env.JWT_TTL_SECONDS = originalTtl;
  if (originalPythonUrl === undefined) delete process.env.PYTHON_SERVICE_URL;
  else process.env.PYTHON_SERVICE_URL = originalPythonUrl;
  if (originalPythonTimeout === undefined) delete process.env.PYTHON_TIMEOUT_MS;
  else process.env.PYTHON_TIMEOUT_MS = originalPythonTimeout;
});

describe('proxy Node → Python', () => {
  it('valida el JWT localment i envia només el cos JSON a Python', async () => {
    const bearer = token();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ answer: 'Hola' }),
    });

    await expect(proxyToPython({
      path: '/chat/internal',
      token: bearer,
      body: { message: 'Bon dia' },
    })).resolves.toEqual({ answer: 'Hola' });

    expect(fetchMock).toHaveBeenCalledWith('http://python-service:8000/chat/internal', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'Bon dia' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('fa servir PYTHON_TIMEOUT_MS quan està configurada', async () => {
    process.env.PYTHON_TIMEOUT_MS = '1234';
    const timeoutMock = jest.spyOn(AbortSignal, 'timeout');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    });

    await proxyToPython({ path: '/chat/internal', token: token() });

    expect(timeoutMock).toHaveBeenCalledWith(1234);
  });

  it('no truca a Python sense un JWT vàlid de Caliu', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    });

    await expect(proxyToPython({ path: '/chat/internal', token: '' })).rejects.toMatchObject({
      status: 401,
      message: 'Autenticació requerida',
    });
    await expect(proxyToPython({
      path: '/chat/internal',
      token: token({}, { audience: 'una-altra-api' }),
    })).rejects.toMatchObject({ status: 401, message: 'Sessió no vàlida' });
    await expect(proxyToPython({
      path: '/chat/internal',
      token: jwt.sign({ jti: JTI }, SECRET, {
        algorithm: 'HS256',
        subject: USER_ID,
        issuer: 'caliu-api',
        audience: 'caliu-android',
      }),
    })).rejects.toMatchObject({ status: 401, message: 'Sessió no vàlida' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rebutja rutes fora del servei Python configurat', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    });

    await expect(proxyToPython({ path: '//example.com/path', token: token() })).rejects.toMatchObject({
      status: 500,
      message: 'Ruta del servei Python no vàlida',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 500 si PYTHON_SERVICE_URL falta, no és vàlida o usa un protocol no permès', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    delete process.env.PYTHON_SERVICE_URL;
    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 500,
      message: 'Falta la variable d\'entorn PYTHON_SERVICE_URL',
    });

    process.env.PYTHON_SERVICE_URL = 'not-a-url';
    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 500,
      message: 'PYTHON_SERVICE_URL no vàlida',
    });

    process.env.PYTHON_SERVICE_URL = 'ftp://python-service:8000';
    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 500,
      message: 'Ruta del servei Python no vàlida',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rebutja PYTHON_TIMEOUT_MS invàlid abans de fer la petició', async () => {
    process.env.PYTHON_TIMEOUT_MS = 'no-es-un-enter';
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 500,
      message: 'PYTHON_TIMEOUT_MS ha de ser un enter entre 1 i 300000',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 503 si el servei Python no respon i 504 si excedeix el temps límit (#143)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'));

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 503,
      message: 'El servei de xatbot no està disponible',
      errorCode: 'CHATBOT_UNAVAILABLE',
    });

    fetchMock.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 504,
      message: 'El servei de xatbot ha tardat massa a respondre',
      errorCode: 'CHATBOT_TIMEOUT',
    });
  });

  it.each([
    ['CHATBOT_UNAVAILABLE', 'El servei de xatbot no està disponible'],
    ['EVENTS_UNAVAILABLE', 'El servei d\'esdeveniments no està disponible'],
  ])('passa el codi %s dels 503 de Python amb un missatge propi', async (code, message) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: 'text intern de Python', code }),
    });

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 503, message, errorCode: code,
    });
  });

  it('retorna 502 si Python respon amb JSON invàlid o un error 5xx', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'no és JSON',
    });

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 502,
      message: 'El servei de xatbot ha fallat',
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ detail: 'internal detail', code: 'ALTRE_CODI' }),
    });

    // Un codi desconegut de Python no s'accepta: es tracta com un error genèric.
    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 502,
      message: 'El servei de xatbot ha fallat',
      errorCode: 'CHATBOT_ERROR',
    });
  });

  it('tradueix errors 4xx de Python sense exposar-ne el cos', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ detail: 'internal detail' }),
    });

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 401,
      message: 'Sessió no vàlida',
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ detail: 'internal detail' }),
    });

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 400,
      message: 'El servei de xatbot ha fallat',
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ detail: 'invalid body' }),
    });

    await expect(proxyToPython({ path: '/chat/internal', token: token() })).rejects.toMatchObject({
      status: 502,
      message: 'El servei de xatbot ha fallat',
    });
  });
});
