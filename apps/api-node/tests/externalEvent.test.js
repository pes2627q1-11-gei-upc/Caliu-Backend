import { externalEvent } from '../src/domain/externalEvent.js';

const start = new Date('2026-12-26T18:00:00.000Z');
const end = new Date('2026-12-26T20:00:00.000Z');

// Document tal com surt de Mongo (lean), amb tots els camps, també els que no s'han d'exposar.
const fullEvent = {
  _id: '6710f1c2a1b2c3d4e5f60718',
  code: 'agenda-123',
  title: 'Concert de Sant Esteve',
  description: 'Descripció llarga',
  startDate: start,
  endDate: end,
  schedule: '19 h',
  venue: 'Auditori',
  address: 'C. Major, 1',
  municipality: 'Girona',
  comarca: 'Gironès',
  location: { type: 'Point', coordinates: [2.82, 41.98] },
  categories: ['Música'],
  tags: ['música', 'nadal'],
  price: 0,
  url: 'https://agenda.cultura.gencat.cat/concert',
  images: ['https://agenda.cultura.gencat.cat/img.jpg'],
  email: 'info@example.cat',
  phone: '972000000',
  source: 'ingest',
  createdAt: start,
  updatedAt: start,
  distanceMeters: 1234,
};

describe('#213 DTO extern', () => {
  it('retorna exactament els camps del contracte amb Xematrip', () => {
    expect(externalEvent(fullEvent)).toEqual({
      title: 'Concert de Sant Esteve',
      startDate: start,
      endDate: end,
      schedule: '19 h',
      location: {
        address: 'C. Major, 1',
        municipality: 'Girona',
        comarca: 'Gironès',
        coordinates: [2.82, 41.98],
      },
      tags: ['música', 'nadal'],
      url: 'https://agenda.cultura.gencat.cat/concert',
    });
  });

  it.each(['description', 'categories', 'price', 'images', 'email', 'phone', 'venue', 'code', 'source',
    '_id', 'id', 'createdAt', 'updatedAt', 'distanceMeters'])('no exposa el camp %s', (field) => {
    expect(externalEvent(fullEvent)).not.toHaveProperty(field);
  });

  it('omple amb valors buits els camps que falten', () => {
    expect(externalEvent({ title: 'Sense dades', startDate: start })).toEqual({
      title: 'Sense dades',
      startDate: start,
      endDate: null,
      schedule: '',
      location: { address: '', municipality: '', comarca: '', coordinates: null },
      tags: [],
      url: '',
    });
  });

  it('retorna còpies de les etiquetes i les coordenades', () => {
    const event = structuredClone(fullEvent);
    const dto = externalEvent(event);
    dto.tags.push('modificada');
    dto.location.coordinates[0] = 0;
    expect(event.tags).toEqual(['música', 'nadal']);
    expect(event.location.coordinates).toEqual([2.82, 41.98]);
  });
});
