import { jest } from '@jest/globals';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { httpError } from '../src/domain/httpError.js';

function send(err) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  errorHandler(err, {}, res, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('#143 errorHandler', () => {
  it('afegeix el codi propi i mostra el missatge també en un 5xx', () => {
    expect(send(httpError(503, 'El servei de xatbot no està disponible', 'CHATBOT_UNAVAILABLE'))).toEqual({
      status: 503, body: { error: 'El servei de xatbot no està disponible', code: 'CHATBOT_UNAVAILABLE' },
    });
  });

  it('un 5xx sense codi propi amaga el missatge i no afegeix codi', () => {
    expect(send(new Error('mongodb://usuari:clau@host'))).toEqual({
      status: 500, body: { error: 'Error intern del servidor' },
    });
  });

  it('no exposa el codi numèric dels errors de Mongo', () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key { email: "a@b.cat" }'), { code: 11000 });
    expect(send(duplicate)).toEqual({ status: 500, body: { error: 'Error intern del servidor' } });
  });

  it('els 4xx mantenen el missatge, amb codi només si en tenen', () => {
    expect(send(httpError(400, 'Camp no vàlid'))).toEqual({ status: 400, body: { error: 'Camp no vàlid' } });
    expect(send(httpError(404, 'No trobat', 'SESSION_NOT_FOUND')))
      .toEqual({ status: 404, body: { error: 'No trobat', code: 'SESSION_NOT_FOUND' } });
  });
});
