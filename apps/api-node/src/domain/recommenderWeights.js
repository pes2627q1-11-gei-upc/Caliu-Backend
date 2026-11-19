import { httpError } from './httpError.js';

// Pesos inicials del recomanador (#126). Es poden ajustar sense redesplegar (HU #10);
// el significat de cada pes es documenta a docs/ (#128).
export const DEFAULT_WEIGHTS = Object.freeze({
  favoriteCategories: 3, // l'esdeveniment és d'una categoria dels favorits de l'usuari
  favoriteTags: 1, // comparteix etiquetes amb els favorits de l'usuari
  preferences: 2, // és d'una categoria de les preferències de l'usuari
  proximity: 2, // és a prop, dins del radi d'activitat de l'usuari
});

export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);

// Cert si almenys un pes és més gran que 0: amb tots a 0 el recomanador no ordenaria res.
// La fan servir validateWeights i loadRecommenderWeights perquè apliquin la mateixa regla.
export function hasPositiveWeight(weights) {
  return WEIGHT_KEYS.some((key) => weights[key] > 0);
}

// Valida un canvi de pesos (total o parcial) i retorna els pesos resultants.
// Rebutja claus desconegudes, valors no numèrics, negatius o infinits, i que tots quedin a 0.
export function validateWeights(input, current = DEFAULT_WEIGHTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'Els pesos han de ser un objecte');
  }
  const unknown = Object.keys(input).filter((key) => !WEIGHT_KEYS.includes(key));
  if (unknown.length) throw httpError(400, `Pes desconegut: ${unknown.join(', ')}`);
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw httpError(400, `El pes ${key} ha de ser un número >= 0`);
    }
  }
  const weights = { ...current, ...input };
  if (!hasPositiveWeight(weights)) {
    throw httpError(400, 'Almenys un pes ha de ser més gran que 0');
  }
  return weights;
}
