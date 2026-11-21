// Consulta i modifica els pesos del recomanador (#127, HU #10) sense redesplegar.
// Només el pot executar qui té accés a la base de dades (MONGO_URI): no hi ha cap ruta a l'API.
//
//   npm run recommender:weights                                  -> mostra els pesos vigents
//   npm run recommender:weights -- proximity=3 favoriteTags=1.5  -> valida, desa i mostra els nous
//   npm run recommender:weights -- --reset                       -> torna als pesos per defecte
//
// El significat de cada pes es documenta a docs/ (#128).
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { parseWeightArgs } from '../domain/recommenderWeights.js';
import {
  loadRecommenderWeights,
  resetRecommenderWeights,
  saveRecommenderWeights,
} from '../models/RecommenderConfig.js';

async function run() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  // El format es comprova abans de connectar; els valors es validen contra els pesos vigents.
  const changes = reset ? null : parseWeightArgs(args);
  await connectDB();

  let weights;
  if (reset) {
    weights = await resetRecommenderWeights();
    console.log('Pesos restablerts als valors per defecte:');
  } else if (args.length) {
    weights = await saveRecommenderWeights(changes);
    console.log('Pesos desats:');
  } else {
    weights = await loadRecommenderWeights();
    console.log('Pesos vigents:');
  }
  console.log(JSON.stringify(weights, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  // Els errors de validació expliquen què cal corregir; la resta (p. ex. de connexió) poden
  // contenir la URI de la BD, així que no es mostren.
  console.error(err.status === 400 ? `Pesos no vàlids: ${err.message}` : 'No s’han pogut gestionar els pesos del recomanador');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
