import { jest } from '@jest/globals';
import request from 'supertest';

// Es simula el model Event perquè els tests no necessiten MongoDB.
const findById = jest.fn();
jest.unstable_mockModule('../src/models/Event.js', () => ({
  default: { findById, find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() },
}));

const { default: app } = await import('../src/app.js');

const ID = '64b7f0c2a1b2c3d4e5f60718';
const KEY = 'clau-de-test-de-waygo-que-no-ha-de-sortir';
const BCN = { _id: ID, title: 'Concert', municipality: 'Barcelona', location: { type: 'Point', coordinates: [2.1701, 41.387] } };
const lean = (value) => ({ lean: () => Promise.resolve(value) });

const RESULTS = [
  { type: 'bike_station', point_id: 'bicing_1', name: 'Estació lluny', address: 'C/ A', distance_meters: 800.2, maps_url: 'https://maps/1', available_electric_bikes: 1, available_mechanical_bikes: 1, available_slots: 10, system: 'Bicing' },
  { type: 'charging_point', point_id: 'ev_1', name: 'Carregador', address: 'Pl. Catalunya', distance_meters: 4.73, maps_url: 'https://maps/2', number_of_chargers: 3, status: 'OPEN', speed_category: 'Fast', current_type: 'AC/DC' },
  { type: 'bike_station', point_id: 'bicing_2', name: 'PL. CATALUNYA, 20', address: 'PL. CATALUNYA, 20', distance_meters: 72.01, maps_url: 'https://maps/3', available_electric_bikes: 11, available_mechanical_bikes: 0, available_slots: 19, system: 'Bicing' },
  { type: 'bike_station', point_id: 'ambici_1', name: 'AMBici', address: 'C/ B', distance_meters: 450, maps_url: 'javascript:alert(1)', available_electric_bikes: 2, available_mechanical_bikes: 3, available_slots: 23, system: 'AMBici' },
  { type: 'charging_point', point_id: 'ev_2', name: 'Carregador 2', address: 'C/ C', distance_meters: 300, maps_url: 'https://maps/4', number_of_chargers: 1, status: 'CLOSE', speed_category: 'Slow', current_type: 'AC' },
  { type: 'taxi', point_id: 'x', name: 'Desconegut', distance_meters: 10 },
];

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const original = { url: process.env.WAYGO_API_URL, key: process.env.WAYGO_API_KEY, timeout: process.env.WAYGO_TIMEOUT_MS };
let fetchSpy;
let logged;

beforeEach(() => {
  process.env.WAYGO_API_URL = 'https://waygo.example';
  process.env.WAYGO_API_KEY = KEY;
  delete process.env.WAYGO_TIMEOUT_MS;
  findById.mockReset().mockReturnValue(lean(BCN));
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { results: RESULTS }));
  logged = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const [name, value] of [['WAYGO_API_URL', original.url], ['WAYGO_API_KEY', original.key], ['WAYGO_TIMEOUT_MS', original.timeout]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const get = (id = ID) => request(app).get(`/events/${id}/mobility`);
const UNAVAILABLE = { available: false, summary: null, points: [] };

describe('#226 GET /events/{id}/mobility', () => {
  it.each([['no-és-un-id'], [ID]])('retorna 404 si l\'esdeveniment %p no existeix', async (id) => {
    findById.mockReturnValue(lean(null));
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('si falla la base de dades, passa l\'error a l\'errorHandler (500)', async () => {
    findById.mockReturnValue({ lean: () => Promise.reject(new Error('mongo caigut')) });
    const res = await get();
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['fora de Barcelona', { ...BCN, municipality: 'Girona' }],
    ['sense coordenades', { ...BCN, location: undefined }],
    ['amb coordenades no vàlides', { ...BCN, location: { type: 'Point', coordinates: ['x', 41.38] } }],
  ])('%s no crida WayGo i no mostra la secció', async (_label, event) => {
    findById.mockReturnValue(lean(event));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UNAVAILABLE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([['WAYGO_API_URL'], ['WAYGO_API_KEY']])('sense %s no crida WayGo', async (name) => {
    delete process.env[name];
    expect((await get()).body).toEqual(UNAVAILABLE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('crida WayGo amb la clau al servidor i retorna els punts, ordenats, amb el resum', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url.toString()).toBe('https://waygo.example/api/external/nearby-mobility/?lat=41.387&lon=2.1701&radius=1500');
    expect(options.headers['X-API-Key']).toBe(KEY);

    expect(res.body.available).toBe(true);
    expect(res.body.summary).toEqual({ bikeStations: 2, freeSlots: 42, chargingPoints: 2, withinMeters: 500 });
    expect(res.body.points.map((point) => point.distanceMeters)).toEqual([5, 72, 300, 450, 800]);
    expect(res.body.points[1]).toEqual({
      type: 'bike_station', name: 'PL. CATALUNYA, 20', address: 'PL. CATALUNYA, 20', distanceMeters: 72,
      mapsUrl: 'https://maps/3', system: 'Bicing', electricBikes: 11, mechanicalBikes: 0, freeSlots: 19,
    });
    expect(res.body.points[0]).toEqual({
      type: 'charging_point', name: 'Carregador', address: 'Pl. Catalunya', distanceMeters: 5,
      mapsUrl: 'https://maps/2', chargers: 3, status: 'OPEN', speed: 'Fast', current: 'AC/DC',
    });
    expect(res.body.points.find((point) => point.system === 'AMBici').mapsUrl).toBe('');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('accepta Barcelona sense distingir majúscules', async () => {
    findById.mockReturnValue(lean({ ...BCN, municipality: ' BARCELONA ' }));
    expect((await get()).body.available).toBe(true);
  });

  it.each([
    ['respon 403', () => fetchSpy.mockResolvedValue(jsonResponse(403, { detail: 'forbidden' }))],
    ['respon 500', () => fetchSpy.mockResolvedValue(jsonResponse(500, {}))],
    ['tarda massa', () => fetchSpy.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))],
    ['no es pot contactar', () => fetchSpy.mockRejectedValue(new TypeError('fetch failed'))],
    ['respon sense results', () => fetchSpy.mockResolvedValue(jsonResponse(200, { items: [] }))],
    ['no retorna cap punt vàlid', () => fetchSpy.mockResolvedValue(jsonResponse(200, { results: [{ type: 'taxi' }] }))],
    ['té una URL no vàlida', () => { process.env.WAYGO_API_URL = 'no és una url'; }],
  ])('si WayGo %s, la fitxa es mostra sense la secció', async (_label, setup) => {
    setup();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UNAVAILABLE);
    expect(logged.mock.calls.flat().join(' ')).not.toContain(KEY);
  });

  it('fa servir un temps màxim de 5 s, configurable amb WAYGO_TIMEOUT_MS', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await get();
    process.env.WAYGO_TIMEOUT_MS = '2000';
    await get();
    process.env.WAYGO_TIMEOUT_MS = 'molt';
    await get();
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([5000, 2000, 5000]);
  });
});
