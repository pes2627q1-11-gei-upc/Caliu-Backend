import { jest } from '@jest/globals';
import request from 'supertest';

// Es simula el model Event perquè els tests no necessiten MongoDB.
const findById = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({
  default: { findById, find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() },
}));

const { default: app } = await import('../src/app.js');

const ID = '64b7f0c2a1b2c3d4e5f60718';

// Document tal com el retorna Mongoose amb .lean(): inclou camps interns que l'API amaga.
const DOC = {
  _id: ID,
  __v: 0,
  createdAt: new Date('2026-10-15T04:00:00Z'),
  updatedAt: new Date('2026-10-19T04:00:00Z'),
  code: '20261024001',
  title: 'Concert de prova',
  description: 'Descripció llarga de l\'esdeveniment.',
  startDate: new Date('2026-10-23T22:00:00Z'),
  endDate: new Date('2026-10-24T21:59:59Z'),
  schedule: 'A les 21 h',
  venue: 'Sala Apolo',
  address: 'C/ Nou de la Rambla, 113',
  municipality: 'Barcelona',
  comarca: 'Barcelonès',
  location: { type: 'Point', coordinates: [2.17, 41.38] },
  categories: ['Música', 'Nit'],
  tags: ['Concerts'],
  price: 12.5,
  url: 'https://exemple.cat/concert',
  images: ['https://agenda.cultura.gencat.cat/content/dam/agenda/a.jpg'],
  email: 'info@exemple.cat',
  phone: '938 123 456',
  source: 'ingest',
};

const leanResolving = (value) => ({ lean: () => Promise.resolve(value) });

describe('GET /events/:id', () => {
  beforeEach(() => findById.mockReset());

  it('retorna tota la informació de l\'esdeveniment en un sol document', async () => {
    findById.mockReturnValue(leanResolving(DOC));

    const res = await request(app).get(`/events/${ID}`);

    expect(res.status).toBe(200);
    expect(findById).toHaveBeenCalledWith(ID);
    expect(res.body).toMatchObject({
      id: ID,
      code: '20261024001',
      title: 'Concert de prova',
      description: DOC.description,
      schedule: 'A les 21 h',
      venue: 'Sala Apolo',
      address: 'C/ Nou de la Rambla, 113',
      municipality: 'Barcelona',
      comarca: 'Barcelonès',
      location: { type: 'Point', coordinates: [2.17, 41.38] },
      categories: ['Música', 'Nit'],
      tags: ['Concerts'],
      price: 12.5,
      url: 'https://exemple.cat/concert',
      images: DOC.images,
      email: 'info@exemple.cat',
      phone: '938 123 456',
    });
    expect(res.body.startDate).toBe('2026-10-23T22:00:00.000Z');
    expect(res.body.endDate).toBe('2026-10-24T21:59:59.000Z');
  });

  it('amaga els camps interns de Mongo', async () => {
    findById.mockReturnValue(leanResolving(DOC));

    const { body } = await request(app).get(`/events/${ID}`);

    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
    expect(body).not.toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('updatedAt');
  });

  it('retorna 404 si l\'id és vàlid però no existeix', async () => {
    findById.mockReturnValue(leanResolving(null));

    const res = await request(app).get(`/events/${ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Esdeveniment no trobat' });
  });

  it('retorna 404 (sense consultar la BD) si l\'id no té format d\'ObjectId', async () => {
    const res = await request(app).get('/events/no-es-un-id');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Esdeveniment no trobat' });
    expect(findById).not.toHaveBeenCalled();
  });

  it('retorna 500 amb el format d\'error de l\'API si falla la BD', async () => {
    findById.mockReturnValue({ lean: () => Promise.reject(new Error('connexió perduda')) });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get(`/events/${ID}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
    spy.mockRestore();
  });

  it('no amaga /events/categories (aquesta ruta va abans de /:id)', async () => {
    const res = await request(app).get('/events/categories');

    expect(res.status).toBe(200);
    expect(res.body.categories).toContain('Música');
    expect(findById).not.toHaveBeenCalled();
  });
});
