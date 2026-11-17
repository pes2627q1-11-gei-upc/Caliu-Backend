import { jest } from '@jest/globals';
import request from 'supertest';

const aggregate = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({ default: { aggregate } }));
const { default: app } = await import('../src/app.js');

beforeEach(() => aggregate.mockReset());

it('ofereix el catàleg sense sessió i abans de la ruta de detall', async () => {
  const locations = [{ comarca: 'Garrotxa', municipality: 'Olot' }];
  aggregate.mockResolvedValue(locations);
  const res = await request(app).get('/events/locations');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ locations });
  const pipeline = aggregate.mock.calls[0][0];
  expect(pipeline[0].$match).toBeDefined();
  expect(pipeline.some((stage) => stage.$group)).toBe(true);
});

it('retorna un catàleg buit sense inventar localitats', async () => {
  aggregate.mockResolvedValue([]);
  const res = await request(app).get('/events/locations');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ locations: [] });
});

it('retorna l’error estàndard si la consulta falla', async () => {
  aggregate.mockRejectedValue(new Error('offline'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await request(app).get('/events/locations');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error intern del servidor' });
  } finally {
    spy.mockRestore();
  }
});
