import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Interaction from '../src/models/Interaction.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';

// Es simula el model Event perquè els tests no necessiten MongoDB.
const findById = jest.fn();
const find = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({
  default: { findById, find, countDocuments: jest.fn().mockResolvedValue(2), aggregate: jest.fn() },
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

describe('#186 estat de preferit a la llista i a la fitxa', () => {
  const secret = 'caliu-test-only-secret-with-at-least-32-bytes';
  const originalSecret = process.env.JWT_SECRET;
  const userId = '64b7f0c2a1b2c3d4e5f60721';
  const otherEventId = '64b7f0c2a1b2c3d4e5f60722';
  const jti = 'a'.repeat(64);
  let token;
  let distinct;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    token = jwt.sign({ jti }, secret, {
      subject: userId, algorithm: 'HS256', issuer: 'caliu-api', audience: 'caliu-android', expiresIn: 3600,
    });
    jest.spyOn(User, 'findById').mockReturnValue(leanResolving({ _id: userId }));
    jest.spyOn(Session, 'exists').mockResolvedValue({ _id: 'session' });
    distinct = jest.spyOn(Interaction, 'distinct').mockResolvedValue([new mongoose.Types.ObjectId(ID)]);
    findById.mockReturnValue(leanResolving(DOC));
    find.mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => leanResolving([DOC, { ...DOC, _id: otherEventId }]) }) }) });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('consulta els preferits de tota la pàgina en una sola operació', async () => {
    const res = await request(app).get('/events').auth(token, { type: 'bearer' });

    expect(res.status).toBe(200);
    expect(res.body.items.map(({ isFavorite }) => isFavorite)).toEqual([true, false]);
    expect(distinct).toHaveBeenCalledTimes(1);
    expect(distinct).toHaveBeenCalledWith('eventId', {
      userId, type: 'favorite', eventId: { $in: [ID, otherEventId] },
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.vary).toContain('Authorization');
  });

  it('retorna un booleà també a la fitxa', async () => {
    const favorite = await request(app).get(`/events/${ID}`).auth(token, { type: 'bearer' });
    distinct.mockResolvedValueOnce([]);
    const other = await request(app).get(`/events/${ID}`).auth(token, { type: 'bearer' });

    expect(favorite.body.isFavorite).toBe(true);
    expect(other.body.isFavorite).toBe(false);
  });

  it('manté públiques les dues rutes i omet el camp sense sessió', async () => {
    const list = await request(app).get('/events');
    const detail = await request(app).get(`/events/${ID}`);

    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(list.body.items[0]).not.toHaveProperty('isFavorite');
    expect(detail.body).not.toHaveProperty('isFavorite');
    expect(detail.headers.vary).toContain('Authorization');
    expect(distinct).not.toHaveBeenCalled();
  });

  it('rebutja un token invàlid o una sessió revocada abans de llegir preferits', async () => {
    expect((await request(app).get('/events').auth('invalid', { type: 'bearer' })).status).toBe(401);
    Session.exists.mockResolvedValueOnce(null);
    expect((await request(app).get(`/events/${ID}`).auth(token, { type: 'bearer' })).status).toBe(401);
    expect(distinct).not.toHaveBeenCalled();
  });
});
