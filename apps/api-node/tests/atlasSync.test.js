import fs from 'node:fs';
import { jest } from '@jest/globals';
import { EVENT_CATEGORIES } from '../src/domain/eventCategories.js';
import { fakeContext, loadTrigger } from './atlasLoader.js';

const T = loadTrigger(undefined);
const plain = (value) => JSON.parse(JSON.stringify(value)); // Date -> ISO string

const item = (n, extra = {}) => ({
  codi: `C${n}`, denominaci: `Esdeveniment ${n}`, latitud: '41.38', longitud: '2.17',
  data_inici: '2026-11-02T00:00:00.000', ...extra,
});

describe('trigger d\'Atlas: casos "golden"', () => {
  // Cada cas és un element cru de Socrata amb la sortida que donava el pipeline antic
  // (trigger + python-service/app/ingest). Si canvieu la normalització a propòsit, regenereu-los.
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/atlas-golden.json', import.meta.url), 'utf8'));

  it.each(golden.map((c) => [c.name, c]))('%s', (_name, c) => {
    const got = T.normalizeItem(c.item);
    expect(got.doc ? { doc: plain(got.doc) } : got).toEqual(c.expected);
  });
});

describe('trigger d\'Atlas: normalització', () => {
  it('EVENT_CATEGORIES coincideix amb el que serveix l\'API', () => {
    expect(T.EVENT_CATEGORIES).toEqual(EVENT_CATEGORIES);
  });

  it('el document té EXACTAMENT els camps del model Event (i cap de l\'esquema cru)', () => {
    const { doc } = T.normalizeItem(item(1, { entrades: 'Preu: 3 €' }));
    expect(Object.keys(doc).sort()).toEqual([
      'address', 'categories', 'code', 'comarca', 'description', 'email', 'endDate', 'images', 'location',
      'municipality', 'phone', 'price', 'schedule', 'source', 'startDate', 'tags', 'title', 'url', 'venue',
    ]);
    expect(doc.startDate).toBeInstanceOf(Date);
    expect(doc.endDate).toBeInstanceOf(Date);
    for (const raw of ['codiGencat', 'titol', 'dataInici', 'localitzacio', 'etiquetes', 'entrades']) {
      expect(doc).not.toHaveProperty(raw);
    }
  });

  it('les dates sense zona són hora de Barcelona (hivern i estiu)', () => {
    expect(new Date(T.parseDate('2026-01-10T10:00:00.000')).toISOString()).toBe('2026-01-10T09:00:00.000Z'); // CET
    expect(new Date(T.parseDate('2026-07-10T10:00:00.000')).toISOString()).toBe('2026-07-10T08:00:00.000Z'); // CEST
  });

  it('rebutja dates impossibles o que no són dates', () => {
    expect(T.parseDate('2026-02-31T10:00:00.000')).toBeNull();
    expect(T.parseDate('no és una data')).toBeNull();
    expect(T.parseDate('')).toBeNull();
    expect(T.parseDate(null)).toBeNull();
  });

  it('una data amb zona explícita es respecta', () => {
    expect(new Date(T.parseDate('2026-07-10T10:00:00Z')).toISOString()).toBe('2026-07-10T10:00:00.000Z');
  });

  it.each([
    ['A les 18 h', 18], ['21.30 h', 21], ['A partir de les 18.30 h', 18],
    ['20 h Durada aproximada: 1 hora i 30 minuts.', 20],
    ['Dimarts: de 16 a 20 h De dimecres a dissabtes: d\'11 a 22 h', null], ['1 hora de durada', null], ['', null], [null, null],
  ])('hourFromSchedule(%j) = %j', (text, expected) => {
    expect(T.hourFromSchedule(text)).toBe(expected);
  });

  it.each([
    ['Consultar condicions', 'Sí', 0], ['Consultar condicions', 'No', null], ['Preu: 3 €', 'No', 3],
    ['Els concerts són d\'accés gratuït.', 'No', 0], ['12,50 €', undefined, 12.5], ['', 'No', null],
    [undefined, undefined, null], ['Reserva al 938 123 456', 'No', null], ['Entrades a partir de les 18 h', 'No', null],
    ['Aforament limitat a 50 persones', 'No', null], ['5 euros', 'No', 5], ['Preu: € 7,50', 'No', 7.5],
  ])('parsePrice(%j, %j) = %j', (text, free, expected) => {
    expect(T.parsePrice(text, free)).toBe(expected);
  });

  it('categoritza igual que abans', () => {
    expect(T.categorize('agenda:categories/teatre')).toEqual(['Teatre']);
    expect(T.categorize('res', '', 22)).toContain('Nit');
    expect(T.categorize('res', '', null)).toEqual([]);
    expect(T.categorize('Frame Film Festival')).toEqual(['Arts']);
    expect(T.categorize('Circuit de curses')).toEqual([]); // "circ$" és paraula exacta
    expect(T.categorize('Josafat', 'Una sola menció de concert.')).toEqual([]);
    expect(T.categorize('Josafat', 'Un concert de jazz i música en directe.')).toEqual(['Música']);
  });

  it('municipi, comarca i etiquetes a partir dels slugs de l\'agenda', () => {
    expect(T.parsePlace('agenda:ubicacions/barcelona/barcelones/barcelona', 'agenda:ubicacions/barcelona/barcelones')).toEqual(['Barcelona', 'Barcelonès']);
    expect(T.parsePlace('Girona', 'Gironès')).toEqual(['Girona', 'Gironès']);
    expect(T.parsePlace(null, null)).toEqual(['', '']);
    expect(T.slugToLabel('vilafranca-del-penedes')).toBe('Vilafranca del Penedes');
    expect(T.slugToLabel('l-hospitalet-de-llobregat')).toBe('L\'Hospitalet de Llobregat');
  });

  it('imatges: relatives al host bo, i el host antic es reescriu', () => {
    expect(T.parseImages('/content/dam/a.jpg,https://cultura.gencat.cat/content/dam/b.jpg')).toEqual([
      'https://agenda.cultura.gencat.cat/content/dam/a.jpg',
      'https://agenda.cultura.gencat.cat/content/dam/b.jpg',
    ]);
  });

  it('url: ignora el cercador de l\'agenda', () => {
    expect(T.pickEventUrl('https://a.cat/x,https://b.cat')).toBe('https://a.cat/x');
    expect(T.pickEventUrl('https://agenda.cultura.gencat.cat')).toBe('');
  });

  it('un camp url de Socrata de tipus objecte {url} també funciona', () => {
    const { doc } = T.normalizeItem(item(1, { url: { url: 'https://exemple.cat/x' } }));
    expect(doc.url).toBe('https://exemple.cat/x');
  });

  it('descodifica la taxonomia dels enllaços del cercador i ignora el que no és vàlid', () => {
    const search =
      'https://agenda.cultura.gencat.cat/content/agenda/ca/results.html?c=eyJrZXl3b3JkcyI6IiIsImRhdGFPcHRpb24iOiIiLCJkYXRhRGVzZGUiOiIiLCJkYXRhRmluc2EiOiIiLCJlc3BhaSI6IiIsInBvYmxhY2lvIjoiIiwiYW1iaXRzIjpbImFnZW5kYTphbWJpdHMvbXVzaWNhIl0sImNhdGVnb3JpZXMiOlsiYWdlbmRhOmNhdGVnb3JpZXMvZmVzdGl2YWxzLWktbW9zdHJlcyJdfQ__&page=0';
    expect(T.gencatTaxonomy(search)).toEqual(['musica', 'festivals i mostres']);
    expect(T.gencatTaxonomy('https://example.cat/?c=%%%')).toEqual([]);
    expect(T.gencatTaxonomy(null)).toEqual([]);
  });

  it('cleanText treu HTML i desfà entitats', () => {
    expect(T.cleanText('<p>Hola</p><br/>m&eacute;s &amp; &#233; &#x41;')).toBe('Hola\n\nmés & é A');
    expect(T.cleanText(null)).toBe('');
  });

  it('buildOperation: upsert per code, timestamps de Mongoose i $unset dels opcionals que falten', () => {
    const now = new Date('2026-10-21T04:00:00Z');
    const { doc } = T.normalizeItem(item(1));
    const noOpt = { ...doc };
    delete noOpt.location;
    delete noOpt.price;
    const op = T.buildOperation(noOpt, now).updateOne;
    expect(op.filter).toEqual({ code: 'C1' });
    expect(op.upsert).toBe(true);
    expect(op.update.$set.updatedAt).toEqual(now);
    expect(op.update.$setOnInsert).toEqual({ createdAt: now });
    expect(op.update.$set).not.toHaveProperty('createdAt');
    expect(Object.keys(op.update.$unset).sort()).toEqual(['location', 'price']);
  });
});

describe('trigger d\'Atlas: execució completa (exports)', () => {
  const rawPage = (n, from = 0) => Array.from({ length: n }, (_, i) => item(from + i));

  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {})); // el trigger escriu logs
  afterEach(() => jest.restoreAllMocks());

  it('escriu NOMÉS a Caliu.esdeveniments', async () => {
    const { context, calls } = fakeContext([rawPage(3)]);
    const result = await loadTrigger(context).run();

    expect(result.status).toBe('success');
    expect(calls.dbs).toEqual(['Caliu']);
    expect(calls.collections).toEqual(['esdeveniments']);
    expect(calls.collections).not.toContain('events');
  });

  it('pagina fins a la pàgina incompleta i escriu en lots', async () => {
    const { context, calls } = fakeContext([rawPage(1000), rawPage(5, 1000)]);
    const result = await loadTrigger(context).run();

    expect(calls.urls).toHaveLength(2);
    expect(decodeURIComponent(calls.urls[0])).toContain('$offset=0');
    expect(decodeURIComponent(calls.urls[1])).toContain('$offset=1000');
    expect(decodeURIComponent(calls.urls[0])).toContain('$order=data_inici ASC, codi ASC'); // desempat estable
    expect(result).toMatchObject({ llegits: 1005, esdeveniments_processats: 1005, nous_inserits: 1005, saltats: {} });
    expect(calls.bulk.map((b) => b.operations.length)).toEqual([500, 500, 5]);
    expect(calls.bulk.every((b) => b.options.ordered === false)).toBe(true);
  });

  it('el filtre inclou tot l\'últim dia de la finestra', async () => {
    const { context, calls } = fakeContext([[]]);
    await loadTrigger(context).run();

    const where = decodeURIComponent(calls.urls[0].split('$where=')[1]);
    expect(where).toMatch(/^data_fi>='\d{4}-\d{2}-\d{2}' and data_fi<='\d{4}-\d{2}-\d{2}' and data_inici<='\d{4}-\d{2}-\d{2}T23:59:59'$/);
  });

  it('compta els saltats, desduplica per codi (l\'últim guanya) i no escriu res si no hi ha vàlids', async () => {
    const { context, calls } = fakeContext([[
      item(1), item(1, { denominaci: 'Nou títol' }), item(2, { codi: '' }), item(3, { latitud: '48.85' }),
      item(4, { latitud: 'x' }), item(5, { data_inici: '' }),
    ]]);
    const result = await loadTrigger(context).run();

    expect(result.saltats).toEqual({
      codi_duplicat: 1, sense_codi: 1, fora_de_catalunya: 1, sense_coordenades: 1, sense_data_inici: 1,
    });
    const [{ operations }] = calls.bulk;
    expect(operations).toHaveLength(1);
    expect(operations[0].updateOne.update.$set.title).toBe('Nou títol');

    const empty = fakeContext([[item(9, { codi: '' })]]);
    expect(await loadTrigger(empty.context).run()).toMatchObject({ status: 'no_data' });
    expect(empty.calls.bulk).toHaveLength(0);
  });

  it('si l\'API de la Generalitat falla, llança l\'error i no escriu res (ni parcialment)', async () => {
    const { context, calls } = fakeContext([rawPage(1000), []], { statuses: [200, 500] });
    await expect(loadTrigger(context).run()).rejects.toThrow(/500/);
    expect(calls.bulk).toHaveLength(0);
  });

  it('un element estrany no tomba tota la sincronització', async () => {
    const { context, calls } = fakeContext([[item(1), null, item(2)]]);
    const result = await loadTrigger(context).run();
    expect(result.esdeveniments_processats).toBe(2);
    expect(result.saltats).toEqual({ error_inesperat: 1 });
    expect(calls.bulk).toHaveLength(1);
  });
});
