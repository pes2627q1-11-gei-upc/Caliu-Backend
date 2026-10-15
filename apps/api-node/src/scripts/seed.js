// Carrega esdeveniments FICTICIS perquè el frontend pugui treballar abans que
// la ingesta real (python-service) estigui feta.
//
//   npm run seed          -> esborra els de prova i en torna a crear (dates relatives a avui)
//   npm run seed:clear    -> només esborra els de prova
//
// Només toca documents amb source = 'seed'; mai les dades reals.
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Event from '../models/Event.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Dades de prova. coords = [longitud, latitud]. Les hores són UTC.
const SEED = [
  { n: 1, title: 'Vinils al capvespre', categories: ['Música'], tags: ['Música', 'En directe', 'Vinils'], d: 1, h: 16, dur: 3, mun: 'Barcelona', com: 'Barcelonès', venue: 'Can Casacuberta', coords: [2.1734, 41.3851], price: 0 },
  { n: 2, title: 'Argila i cafè', categories: ['Tallers', 'Arts'], tags: ['Taller', 'Cafè'], d: 2, h: 9, dur: 2, mun: 'Sabadell', com: 'Vallès Occidental', venue: 'Cafè del Centre', coords: [2.1086, 41.5463], price: 12 },
  { n: 3, title: 'Mercat Nocturn', categories: ['Gastronomia', 'Nit', 'Menjar i beguda'], tags: ['Mercat', 'Camions de menjar'], d: 0, h: 17, dur: 5, mun: 'Barcelona', com: 'Barcelonès', venue: 'Plaça del Mercat', coords: [2.1890, 41.3870], price: 0 },
  { n: 4, title: 'Caminata Popular', categories: ['Esports', "A l'aire lliure"], tags: ['Família', 'Caminada'], d: 3, h: 8, dur: 3, mun: 'Mataró', com: 'Maresme', venue: 'Passeig Marítim', coords: [2.4445, 41.5381], price: 0 },
  { n: 5, title: 'Festival Sonar Beats', categories: ['Música', 'Arts'], tags: ['Música', "A l'aire lliure", 'En directe', 'Artistes locals', 'Camions de menjar'], d: 1, h: 18, dur: 5, mun: 'Barcelona', com: 'Barcelonès', venue: "El Pati i l'escenari del Yard", coords: [2.1590, 41.3745], price: 25 },
  { n: 6, title: 'Jazz acústic en directe', categories: ['Música', 'Nit'], tags: ['Jazz', 'En directe'], d: 2, h: 19, dur: 2, mun: 'Girona', com: 'Gironès', venue: 'The Velvet Lounge', coords: [2.8249, 41.9794], price: 10 },
  { n: 7, title: "Inauguració d'exposició de fotografia contemporània", categories: ['Arts'], tags: ['Fotografia', 'Exposició'], d: 4, h: 18, dur: 24 * 30, mun: 'Tarragona', com: 'Tarragonès', venue: 'Aura Space', coords: [1.2445, 41.1189], price: 0 },
  { n: 8, title: 'Teatre familiar: El drac de paper', categories: ['Teatre'], tags: ['Família', 'Infantil'], d: 5, h: 16, dur: 1.5, mun: 'Lleida', com: 'Segrià', venue: 'Teatre Municipal', coords: [0.6200, 41.6176], price: 8 },
  { n: 9, title: 'Monòlegs a la fresca', categories: ['Comèdia', 'Nit', "A l'aire lliure"], tags: ['Humor', 'Monòleg'], d: 3, h: 21, dur: 2, mun: 'Sitges', com: 'Garraf', venue: 'Plaça de la Vila', coords: [1.8059, 41.2371], price: 12 },
  { n: 10, title: 'Fira del formatge artesà', categories: ['Gastronomia', 'Menjar i beguda', "A l'aire lliure"], tags: ['Fira', 'Producte local'], d: 6, h: 9, dur: 32, mun: 'Vic', com: 'Osona', venue: 'Plaça Major', coords: [2.2549, 41.9301], price: 0 },
  { n: 11, title: 'Ruta de tapes pel centre', categories: ['Gastronomia', 'Menjar i beguda'], tags: ['Tapes', 'Ruta'], d: 2, h: 11, dur: 4, mun: 'Reus', com: 'Baix Camp', venue: 'Centre històric', coords: [1.1065, 41.1548], price: 15 },
  { n: 12, title: 'Taller de ceràmica per a infants', categories: ['Tallers'], tags: ['Família', 'Infantil', 'Taller'], d: 7, h: 10, dur: 2, mun: 'Manresa', com: 'Bages', venue: 'Casal Cívic', coords: [1.8260, 41.7289], price: 10 },
  { n: 13, title: 'Ball de gegants i castellers', categories: ['Arts', "A l'aire lliure"], tags: ['Cultura popular', 'Tradició'], d: 8, h: 11, dur: 3, mun: 'Vilafranca del Penedès', com: 'Alt Penedès', venue: 'Plaça de la Vila', coords: [1.6992, 41.3453], price: 0 },
  { n: 14, title: 'Sessió DJ a la platja', categories: ['Música', 'Nit', "A l'aire lliure"], tags: ['DJ', 'Platja'], d: 5, h: 19, dur: 4, mun: 'Castelldefels', com: 'Baix Llobregat', venue: 'Platja de Castelldefels', coords: [1.9753, 41.2817], price: 10 },
  { n: 15, title: 'Cursa de muntanya de la Garrotxa', categories: ['Esports', "A l'aire lliure"], tags: ['Cursa', 'Muntanya'], d: 9, h: 7, dur: 5, mun: 'Olot', com: 'Garrotxa', venue: 'Parc Nou', coords: [2.4903, 42.1818], price: 18 },
  { n: 16, title: 'Mostra de cinema independent', categories: ['Arts'], tags: ['Cinema'], d: 4, h: 19, dur: 3, mun: 'Figueres', com: 'Alt Empordà', venue: 'Cinema Municipal', coords: [2.9611, 42.2662], price: 6 },
  { n: 17, title: 'Exposició de ceràmica contemporània', categories: ['Arts'], tags: ['Exposició', 'Ceràmica'], d: 1, h: 9, dur: 24 * 20, mun: 'Tortosa', com: 'Baix Ebre', venue: 'Museu Municipal', coords: [0.5217, 40.8126], price: 0 },
  { n: 18, title: 'Concert de cobla a la plaça', categories: ['Música', "A l'aire lliure"], tags: ['Cobla', 'Cultura popular', 'En directe'], d: 6, h: 18, dur: 2, mun: 'Terrassa', com: 'Vallès Occidental', venue: 'Plaça Vella', coords: [2.0084, 41.5667], price: 0 },
];

function build(e) {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(midnight.getTime() + e.d * DAY + e.h * HOUR);
  const code = `seed-${String(e.n).padStart(3, '0')}`;
  return {
    code,
    title: e.title,
    description: `Esdeveniment de prova a ${e.mun}. Dades fictícies: s'esborraran quan funcioni la ingesta real.`,
    startDate,
    endDate: new Date(startDate.getTime() + e.dur * HOUR),
    venue: e.venue,
    address: '',
    municipality: e.mun,
    comarca: e.com,
    location: { type: 'Point', coordinates: e.coords },
    categories: e.categories,
    tags: e.tags,
    price: e.price,
    url: `https://example.org/esdeveniments/${code}`,
    images: [`https://picsum.photos/seed/${code}/800/450`], // imatge de mostra
    source: 'seed',
  };
}

async function run() {
  const clearOnly = process.argv.includes('--clear');
  await connectDB();
  await Event.init(); // assegura que els índexs (2dsphere, code únic...) existeixen

  const removed = await Event.deleteMany({ source: 'seed' });
  console.log(`Esborrats ${removed.deletedCount} esdeveniments de prova`);

  if (!clearOnly) {
    const created = await Event.create(SEED.map(build));
    console.log(`Creats ${created.length} esdeveniments de prova`);
  }
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Error en el seed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
