import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { parseExternalEventQuery } from '../src/domain/externalEvent.js';

// Es simula el model Event perquè els tests no necessiten MongoDB.
const find = jest.fn();
const countDocuments = jest.fn();
const findById = jest.fn();
const aggregate = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({
  default: { find, countDocuments, findById, aggregate },
}));

// La clau s'ha de definir abans de carregar l'app: el middleware la llegeix en crear-se.
const KEY = 'clau-de-test-xematrip-amb-32-caracters';
const originalKeys = process.env.EXTERNAL_API_KEYS;
process.env.EXTERNAL_API_KEYS = `xematrip:${KEY}`;
const { default: app } = await import('../src/app.js');
// Després del mock: si s'importés abans, es carregaria el model Event real.
const { externalApiAuth } = await import('../src/routes/external.routes.js');

afterAll(() => {
  if (originalKeys === undefined) delete process.env.EXTERNAL_API_KEYS;
  else process.env.EXTERNAL_API_KEYS = originalKeys;
});

const DOC = {
  _id: '64b7f0c2a1b2c3d4e5f60718',
  __v: 0,
  code: 'agenda-1',
  title: 'Concert de Sant Esteve',
  description: 'No s\'ha d\'exposar',
  startDate: new Date('2026-12-26T18:00:00.000Z'),
  endDate: new Date('2026-12-26T20:00:00.000Z'),
  schedule: '19 h',
  address: 'C. Major, 1',
  municipality: 'Girona',
  comarca: 'Gironès',
  location: { type: 'Point', coordinates: [2.82, 41.98] },
  categories: ['Música'],
  tags: ['música'],
  price: 10,
  url: 'https://agenda.cultura.gencat.cat/concert',
  email: 'info@example.cat',
  distanceMeters: 1234.5,
};

const EXPECTED = {
  title: 'Concert de Sant Esteve',
  startDate: '2026-12-26T18:00:00.000Z',
  endDate: '2026-12-26T20:00:00.000Z',
  schedule: '19 h',
  location: { address: 'C. Major, 1', municipality: 'Girona', comarca: 'Gironès', coordinates: [2.82, 41.98] },
  tags: ['música'],
  url: 'https://agenda.cultura.gencat.cat/concert',
};

// Event.find(...).sort(...).skip(...).limit(...).lean()
const chain = (items) => {
  const q = { sort: () => q, skip: () => q, limit: () => q, lean: () => Promise.resolve(items) };
  return q;
};

const get = (query, key = KEY) => {
  const req = request(app).get('/ext/v1/events').query(query);
  return key ? req.set('X-API-Key', key) : req;
};

describe('#214 GET /ext/v1/events', () => {
  beforeEach(() => {
    find.mockReset();
    countDocuments.mockReset();
    findById.mockReset();
    aggregate.mockReset();
  });

  it.each([[null], ['clau-incorrecta']])('rebutja amb 401 la clau %p sense consultar la BD', async (key) => {
    const res = await get({ comarca: 'Gironès' }, key);
    expect(res.status).toBe(401);
    expect(find).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('per comarca retorna els esdeveniments amb el DTO del contracte', async () => {
    find.mockReturnValue(chain([DOC]));
    countDocuments.mockResolvedValue(1);

    const res = await get({ comarca: 'gironès' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [EXPECTED], page: 1, limit: 20, total: 1 });
    const filter = find.mock.calls[0][0];
    expect(filter.comarca.$in[0].test('Gironès')).toBe(true);
    expect(filter.source).toEqual({ $ne: 'seed' });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('per radi ordena per distància amb $geoNear i no exposa distanceMeters', async () => {
    aggregate.mockResolvedValue([{ items: [DOC], total: [{ n: 1 }] }]);

    const res = await get({ lat: 41.38, lng: 2.17, radiusKm: 5 });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([EXPECTED]);
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0].$geoNear).toMatchObject({
      near: { type: 'Point', coordinates: [2.17, 41.38] },
      maxDistance: 5000,
    });
    expect(find).not.toHaveBeenCalled();
  });

  it('filtra pel rang de dates i respecta la paginació', async () => {
    find.mockReturnValue(chain([]));
    countDocuments.mockResolvedValue(0);

    const res = await get({
      comarca: 'Gironès', from: '2026-12-26T00:00:00Z', to: '2026-12-27T00:00:00Z', page: 2, limit: 5,
    });

    expect(res.body).toEqual({ items: [], page: 2, limit: 5, total: 0 });
    const filter = find.mock.calls[0][0];
    expect(filter.endDate.$gte).toEqual(new Date('2026-12-26T00:00:00Z'));
    expect(filter.startDate.$lte).toEqual(new Date('2026-12-27T00:00:00Z'));
  });

  it.each([
    {},
    { comarca: 'Gironès', lat: 41.38, lng: 2.17, radiusKm: 5 },
    { lat: 41.38, lng: 2.17 },
    { radiusKm: 5 },
    { comarca: 'Gironès', category: 'Música' },
    { comarca: 'Gironès', q: 'jazz' },
    { comarca: 'Gironès', from: 'no-és-una-data' },
    { lat: 41.38, lng: 2.17, radiusKm: 501 },
    { comarca: 'Gironès', limit: 0 },
    { comarca: '' },
    { comarca: ' , ' },
    { comarca: 'Gironès,Selva' },
    { comarca: ['Gironès', 'Selva'] },
  ])('rebutja amb 400 la consulta %p', async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(find).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('sense paràmetres demana una zona', () => {
    expect(() => parseExternalEventQuery()).toThrow(/zona/);
  });

  it('només mostra les dades de prova (seed) a l\'entorn de desenvolupament', () => {
    const query = { comarca: 'Gironès' };
    expect(parseExternalEventQuery(query, new Date(), ' Development ').filter.source).toBeUndefined();
    expect(parseExternalEventQuery(query, new Date(), 'production').filter.source).toEqual({ $ne: 'seed' });
    expect(parseExternalEventQuery(query, new Date(), undefined).filter.source).toEqual({ $ne: 'seed' });
  });

  it('amb EXTERNAL_API_KEYS mal configurada només desactiva l\'API externa (503)', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const external = express();
      external.use(externalApiAuth('format-incorrecte'));
      external.get('/events', (_req, res) => res.json({ ok: true }));

      const res = await request(external).get('/events').set('X-API-Key', KEY);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'API externa no disponible' });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('EXTERNAL_API_KEYS'));
      expect(logged.mock.calls.flat().join(' ')).not.toContain('format-incorrecte');
    } finally {
      logged.mockRestore();
    }
  });
});
