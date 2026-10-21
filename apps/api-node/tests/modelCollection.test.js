import Event from '../src/models/Event.js';

describe('col·lecció de la base de dades', () => {
  it('el model Event llegeix i escriu a `esdeveniments` (l\'única col·lecció), no a `events`', () => {
    expect(Event.collection.name).toBe('esdeveniments');
  });
});
