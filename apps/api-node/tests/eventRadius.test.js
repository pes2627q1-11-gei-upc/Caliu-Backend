import { jest } from '@jest/globals';
import request from 'supertest';

// Es simula el model Event perquè els tests no necessiten MongoDB.
const find = jest.fn();
const countDocuments = jest.fn();
const findById = jest.fn();
const aggregate = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({
  default: { find, countDocuments, findById, aggregate },
}));

const { default: app } = await import('../src/app.js');
const at = { lat: '41.38', lng: '2.17' };

describe('GET /events: límits de radiusKm (#111)', () => {
  beforeEach(() => {
    find.mockReset();
    countDocuments.mockReset();
    findById.mockReset();
    aggregate.mockReset();
  });

  it.each([
    ['0.1', 100],
    ['500', 500000],
  ])('accepta radiusKm=%s sense sessió i aplica el límit en metres', async (radiusKm, maxDistance) => {
    aggregate.mockResolvedValue([{ items: [], total: [] }]);

    const res = await request(app).get('/events').query({ ...at, radiusKm });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: 1, limit: 20, total: 0 });
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate.mock.calls[0][0][0].$geoNear).toMatchObject({
      near: { type: 'Point', coordinates: [2.17, 41.38] },
      maxDistance,
    });
    expect(find).not.toHaveBeenCalled();
    expect(countDocuments).not.toHaveBeenCalled();
  });

  it.each(['-1', '0', '0.099', '500.001', 'text', '', ' ', 'NaN', 'Infinity', '-Infinity'])(
    'retorna 400 per radiusKm="%s" sense consultar MongoDB',
    async (radiusKm) => {
      const res = await request(app).get('/events').query({ ...at, radiusKm });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.stringContaining('"radiusKm"') });
      expect(aggregate).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
      expect(countDocuments).not.toHaveBeenCalled();
    },
  );

  it.each([
    { radiusKm: '5' },
    { lat: at.lat, radiusKm: '5' },
    { lng: at.lng, radiusKm: '5' },
  ])('retorna 400 si falten coordenades: %j', async (query) => {
    const res = await request(app).get('/events').query(query);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringMatching(/lat|lng/) });
    expect(aggregate).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(countDocuments).not.toHaveBeenCalled();
  });
});
