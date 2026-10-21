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
  code: '1',
  title: 'Festival de jazz',
  tags: ['Concerts'],
  startDate: new Date('2026-10-24T22:00:00Z'),
  endDate: new Date('2026-10-24T23:59:59Z'),
};

// Event.find(...).sort(...).skip(...).limit(...).lean()
const chain = (items) => {
  const q = { sort: () => q, skip: () => q, limit: () => q, lean: () => Promise.resolve(items) };
  return q;
};

describe('GET /events/search', () => {
  beforeEach(() => {
    find.mockReset();
    countDocuments.mockReset();
    findById.mockReset();
    aggregate.mockReset();
  });

  it('retorna els resultats paginats i amaga els camps interns', async () => {
    find.mockReturnValue(chain([DOC]));
    countDocuments.mockResolvedValue(1);

    const res = await request(app).get('/events/search').query({ q: 'jazz' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: DOC._id, title: 'Festival de jazz' });
    expect(res.body.items[0]).not.toHaveProperty('_id');
    expect(res.body.items[0]).not.toHaveProperty('__v');
  });

  it('consulta la BD amb un filtre que avalua títol i etiquetes', async () => {
    find.mockReturnValue(chain([]));
    countDocuments.mockResolvedValue(0);

    await request(app).get('/events/search').query({ q: 'música' });

    const filter = find.mock.calls[0][0];
    expect(filter.$and).toHaveLength(1);
    const [{ title }, { tags }] = filter.$and[0].$or;
    expect(title.test('Festival de MUSICA')).toBe(true);
    expect(tags.test('Música clàssica')).toBe(true);
    expect(countDocuments).toHaveBeenCalledWith(filter);
  });

  it('combina la cerca amb els altres filtres (categoria i paginació)', async () => {
    find.mockReturnValue(chain([]));
    countDocuments.mockResolvedValue(0);

    const res = await request(app).get('/events/search').query({ q: 'jazz', category: 'Música', page: 2, limit: 5 });

    expect(res.body).toMatchObject({ page: 2, limit: 5, total: 0 });
    expect(find.mock.calls[0][0].categories).toEqual({ $in: ['Música'] });
  });

  it('usa $geoNear si es demana proximitat', async () => {
    aggregate.mockResolvedValue([{ items: [{ ...DOC, distanceMeters: 1234.6 }], total: [{ n: 1 }] }]);

    const res = await request(app).get('/events/search').query({ q: 'jazz', lat: 41.38, lng: 2.17, radiusKm: 5 });

    expect(res.status).toBe(200);
    expect(res.body.items[0].distanceMeters).toBe(1235);
    const [{ $geoNear }] = aggregate.mock.calls[0][0];
    expect($geoNear.maxDistance).toBe(5000);
    expect($geoNear.query.$and).toHaveLength(1);
    expect(find).not.toHaveBeenCalled();
  });

  it('retorna 400 si falta q o és buit', async () => {
    for (const url of ['/events/search', '/events/search?q=', '/events/search?q=%20%20']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/"q"/);
    }
    expect(find).not.toHaveBeenCalled();
  });

  it('no es confon amb GET /events/:id', async () => {
    find.mockReturnValue(chain([]));
    countDocuments.mockResolvedValue(0);

    const res = await request(app).get('/events/search').query({ q: 'a' });

    expect(res.status).toBe(200);
    expect(findById).not.toHaveBeenCalled();
  });

  it('retorna 500 amb el format d\'error de l\'API si falla la BD', async () => {
    find.mockImplementation(() => {
      throw new Error('connexió perduda');
    });
    countDocuments.mockResolvedValue(0);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/events/search').query({ q: 'jazz' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
    spy.mockRestore();
  });
});

describe('GET /events (el refactor comparteix codi amb la cerca)', () => {
  beforeEach(() => {
    find.mockReset();
    countDocuments.mockReset();
  });

  it('continua retornant la llista paginada i el seu "q" també cerca a lloc i municipi', async () => {
    find.mockReturnValue(chain([DOC]));
    countDocuments.mockResolvedValue(1);

    const res = await request(app).get('/events').query({ q: 'jazz' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(res.body.items[0]).toMatchObject({ id: DOC._id });
    const fields = find.mock.calls[0][0].$or.flatMap((c) => Object.keys(c));
    expect(fields).toEqual(['title', 'venue', 'municipality', 'tags']);
  });
});
