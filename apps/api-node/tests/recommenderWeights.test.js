import { jest } from '@jest/globals';
import RecommenderConfig, {
  loadRecommenderWeights, resetRecommenderWeights, saveRecommenderWeights,
} from '../src/models/RecommenderConfig.js';
import { DEFAULT_WEIGHTS, parseWeightArgs, validateWeights } from '../src/domain/recommenderWeights.js';

const stored = (config) => jest.spyOn(RecommenderConfig, 'findById').mockImplementation(() => ({
  lean: async () => config,
}));

afterEach(() => jest.restoreAllMocks());

describe('#126 pesos del recomanador', () => {
  it('desa la configuració en un sol document de recommenderconfigs amb pesos >= 0', () => {
    expect(RecommenderConfig.collection.name).toBe('recommenderconfigs');
    expect(new RecommenderConfig({})._id).toBe('default');
    const negative = new RecommenderConfig({ weights: { proximity: -1 } }).validateSync();
    expect(negative.errors['weights.proximity']).toBeDefined();
    expect(new RecommenderConfig({ weights: { ...DEFAULT_WEIGHTS } }).validateSync()).toBeUndefined();
  });

  it('accepta canvis parcials i manté la resta de pesos', () => {
    expect(validateWeights({ proximity: 0.5 })).toEqual({ ...DEFAULT_WEIGHTS, proximity: 0.5 });
    expect(validateWeights({ favoriteCategories: 0 })).toEqual({ ...DEFAULT_WEIGHTS, favoriteCategories: 0 });
    const current = { ...DEFAULT_WEIGHTS, favoriteTags: 4 };
    expect(validateWeights({}, current)).toEqual(current);
  });

  it.each([null, [], 'pesos', 3, { distance: 1 }, { proximity: -1 }, { proximity: '2' },
    { proximity: null }, { proximity: true }, { proximity: Infinity }, { proximity: NaN },
    { favoriteCategories: 0, favoriteTags: 0, preferences: 0, proximity: 0 }])('rebutja els pesos %p', (input) => {
    let error;
    try {
      validateWeights(input);
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ status: 400, message: expect.any(String) });
  });

  it('sense configuració desada usa els pesos per defecte', async () => {
    stored(null);
    await expect(loadRecommenderWeights()).resolves.toEqual(DEFAULT_WEIGHTS);
    expect(RecommenderConfig.findById).toHaveBeenCalledWith('default');
  });

  it('combina els pesos desats vàlids amb els per defecte i ignora els no vàlids', async () => {
    stored({ _id: 'default', weights: { proximity: 5, favoriteTags: -2, preferences: '9', popularity: 7 } });
    await expect(loadRecommenderWeights()).resolves.toEqual({ ...DEFAULT_WEIGHTS, proximity: 5 });
  });

  it('si els pesos desats són tots 0 usa els per defecte', async () => {
    stored({ _id: 'default', weights: { favoriteCategories: 0, favoriteTags: 0, preferences: 0, proximity: 0 } });
    await expect(loadRecommenderWeights()).resolves.toEqual(DEFAULT_WEIGHTS);
  });
});

describe('#127 script de pesos', () => {
  it('converteix els arguments pes=valor en números', () => {
    expect(parseWeightArgs(['proximity=3', ' favoriteTags = 1.5 '])).toEqual({ proximity: 3, favoriteTags: 1.5 });
    expect(parseWeightArgs([])).toEqual({});
  });

  it.each([['proximity'], ['=3'], ['proximity', 'favoriteTags=1']])('rebutja el format %p', (...args) => {
    expect(() => parseWeightArgs(args)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('un valor buit no s\'accepta com a 0', () => {
    expect(() => validateWeights(parseWeightArgs(['proximity=']))).toThrow(/proximity/);
    expect(() => validateWeights(parseWeightArgs(['proximity=molt']))).toThrow(/proximity/);
  });

  it('desa el canvi combinat amb els pesos vigents', async () => {
    stored({ _id: 'default', weights: { proximity: 5 } });
    const update = jest.spyOn(RecommenderConfig, 'findByIdAndUpdate').mockResolvedValue({});

    const weights = await saveRecommenderWeights({ favoriteTags: 4 });

    expect(weights).toEqual({ ...DEFAULT_WEIGHTS, proximity: 5, favoriteTags: 4 });
    expect(update).toHaveBeenCalledWith(
      'default', { $set: { weights } }, { upsert: true, new: true, runValidators: true },
    );
  });

  it('no desa res si el canvi no és vàlid', async () => {
    stored(null);
    const update = jest.spyOn(RecommenderConfig, 'findByIdAndUpdate').mockResolvedValue({});

    await expect(saveRecommenderWeights({ proximity: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(saveRecommenderWeights({ favoriteCategories: 0, favoriteTags: 0, preferences: 0, proximity: 0 }))
      .rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('restableix els pesos per defecte esborrant la configuració', async () => {
    const remove = jest.spyOn(RecommenderConfig, 'deleteOne').mockResolvedValue({ deletedCount: 1 });
    await expect(resetRecommenderWeights()).resolves.toEqual(DEFAULT_WEIGHTS);
    expect(remove).toHaveBeenCalledWith({ _id: 'default' });
  });
});
