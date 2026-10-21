// Carrega docs/atlas/daily_agenda_sync.js tal com és (és el codi que s'enganxa a Atlas, no un mòdul).
// El fitxer fa `exports = async function () {...}` i espera `context` com a global d'Atlas; aquí
// s'avalua dins d'una funció que els rep per paràmetre i en retornem les peces que es proven.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TRIGGER_PATH = fileURLToPath(new URL('../../../docs/atlas/daily_agenda_sync.js', import.meta.url));
const SOURCE = fs.readFileSync(TRIGGER_PATH, 'utf8');

const EXPORTED = [
  'normalizeItem', 'parseDate', 'parsePrice', 'hourFromSchedule', 'categorize', 'parsePlace',
  'slugToLabel', 'gencatTaxonomy', 'pickEventUrl', 'parseImages', 'cleanText', 'buildOperation',
  'EVENT_CATEGORIES',
];

export function loadTrigger(context) {
  // eslint-disable-next-line no-new-func
  return new Function('exports', 'context', `${SOURCE}\nreturn { run: exports, ${EXPORTED.join(', ')} };`)(
    undefined,
    context,
  );
}

// Context d'Atlas simulat: registra les URLs demanades i les col·leccions/escriptures fetes.
export function fakeContext(pages, { statuses = [] } = {}) {
  const calls = { urls: [], dbs: [], collections: [], bulk: [] };
  const col = {
    bulkWrite: async (operations, options) => {
      calls.bulk.push({ operations, options });
      return { upsertedCount: operations.length, modifiedCount: 0 };
    },
  };
  const queue = [...pages];
  const context = {
    services: {
      get: (name) =>
        name === 'Caliu'
          ? { db: (d) => { calls.dbs.push(d); return { collection: (c) => { calls.collections.push(c); return col; } }; } }
          : null,
    },
    http: {
      get: async ({ url }) => {
        calls.urls.push(url);
        const statusCode = statuses[calls.urls.length - 1] ?? 200;
        const body = queue.shift() ?? [];
        return { statusCode, body: { text: () => JSON.stringify(body) } };
      },
    },
  };
  return { context, calls };
}
