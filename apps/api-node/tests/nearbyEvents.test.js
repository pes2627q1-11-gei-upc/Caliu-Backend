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

const DOC = {
  _id: '64b7f0c2a1b2c3d4e5f60718',
  __v: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  code: 'seed-001',
  title: 'Vinils al capvespre',
  location: { type: 'Point', coordinates: [2.1734, 41.3851] },
  distanceMeters: 635.4872,
};

describe('GET /events/nearby', () => {
  beforeEach(() => {
    find.mockReset();
    countDocuments.mockReset();
    findById.mockReset();
    aggregate.mockReset();
  });

  it('retorna els esdeveniments propers amb distanceMeters arrodonit i sense camps interns', async () => {
    aggregate.mockResolvedValue([{ items: [DOC], total: [{ n: 1 }] }]);

    const res = await request(app).get('/events/nearby').query({ lat: 41.38, lng: 2.17, radiusKm: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(res.body.items[0]).toMatchObject({ id: DOC._id, title: DOC.title, distanceMeters: 635 });
    expect(res.body.items[0]).not.toHaveProperty('_id');
    expect(res.body.items[0]).not.toHaveProperty('__v');
  });

  it('consulta amb $geoNear al radi demanat, en metres', async () => {
    aggregate.mockResolvedValue([{ items: [], total: [] }]);

    await request(app).get('/events/nearby').query({ lat: 41.38, lng: 2.17, radiusKm: 5 });

    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0].$geoNear).toMatchObject({
      near: { type: 'Point', coordinates: [2.17, 41.38] },
      distanceField: 'distanceMeters',
      maxDistance: 5000,
    });
    expect(find).not.toHaveBeenCalled();
  });

  it('usa un radi per defecte de 10 km si no s\'envia radiusKm', async () => {
    aggregate.mockResolvedValue([{ items: [], total: [] }]);

    await request(app).get('/events/nearby').query({ lat: 41.38, lng: 2.17 });

    expect(aggregate.mock.calls[0][0][0].$geoNear.maxDistance).toBe(10000);
  });

  it('retorna total 0 i llista buida si no hi ha res a prop', async () => {
    aggregate.mockResolvedValue([{ items: [], total: [] }]);

    const res = await request(app).get('/events/nearby').query({ lat: 41.38, lng: 2.17 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  it('retorna 400 si falten lat o lng, sense consultar la BD', async () => {
    const res = await request(app).get('/events/nearby').query({ lat: 41.38 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat/);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('retorna 400 si les coordenades són invàlides', async () => {
    const res = await request(app).get('/events/nearby').query({ lat: 200, lng: 2 });

    expect(res.status).toBe(400);
  });

  it('no el confon amb /events/:id', async () => {
    const res = await request(app).get('/events/nearby');

    expect(res.status).toBe(400); // és l'endpoint "nearby" (falten lat/lng), no un 404 d'id
    expect(findById).not.toHaveBeenCalled();
  });
});
