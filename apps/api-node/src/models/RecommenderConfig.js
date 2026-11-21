import mongoose from 'mongoose';
import { DEFAULT_WEIGHTS, WEIGHT_KEYS, hasPositiveWeight, validateWeights } from '../domain/recommenderWeights.js';

// Configuració del recomanador (#126): un sol document amb els pesos, perquè es puguin
// ajustar sense modificar el codi ni redesplegar (HU #10).
export const RECOMMENDER_CONFIG_ID = 'default';

const weight = { type: Number, min: 0 };

const recommenderConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, default: RECOMMENDER_CONFIG_ID },
    weights: {
      favoriteCategories: weight,
      favoriteTags: weight,
      preferences: weight,
      proximity: weight,
    },
  },
  { timestamps: true },
);

const RecommenderConfig = mongoose.model('RecommenderConfig', recommenderConfigSchema);

// Pesos vigents: els desats a la BD que siguin vàlids, i els per defecte per a la resta.
// Sense document (o amb valors editats a mà incorrectament) el recomanador funciona igual.
export async function loadRecommenderWeights() {
  const config = await RecommenderConfig.findById(RECOMMENDER_CONFIG_ID).lean();
  const stored = Object.entries(config?.weights ?? {}).filter(([key, value]) =>
    WEIGHT_KEYS.includes(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const weights = { ...DEFAULT_WEIGHTS, ...Object.fromEntries(stored) };
  // Mateixa regla que validateWeights: amb tots els pesos a 0 es fan servir els per defecte.
  return hasPositiveWeight(weights) ? weights : { ...DEFAULT_WEIGHTS };
}

// Script d'administració (#127): aplica un canvi (total o parcial) sobre els pesos vigents,
// el valida i el desa. Si no és vàlid, llança un error i no es desa res.
export async function saveRecommenderWeights(changes) {
  const weights = validateWeights(changes, await loadRecommenderWeights());
  await RecommenderConfig.findByIdAndUpdate(
    RECOMMENDER_CONFIG_ID,
    { $set: { weights } },
    { upsert: true, new: true, runValidators: true },
  );
  return weights;
}

// Torna als pesos per defecte esborrant la configuració desada.
export async function resetRecommenderWeights() {
  await RecommenderConfig.deleteOne({ _id: RECOMMENDER_CONFIG_ID });
  return { ...DEFAULT_WEIGHTS };
}

export default RecommenderConfig;
