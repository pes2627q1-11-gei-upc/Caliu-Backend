import mongoose from 'mongoose';
import Interaction from '../src/models/Interaction.js';

const userId = new mongoose.Types.ObjectId();
const eventId = new mongoose.Types.ObjectId();

describe('model Interacció', () => {
  it('desa les interaccions i declara un índex únic per usuari, tipus i esdeveniment', () => {
    expect(Interaction.collection.name).toBe('interactions');
    expect(Interaction.schema.indexes()).toContainEqual([
      { userId: 1, type: 1, eventId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('requereix usuari, esdeveniment i un tipus reconegut', () => {
    const { errors } = new Interaction({}).validateSync();
    expect(Object.keys(errors).sort()).toEqual(['eventId', 'type', 'userId']);
    expect(new Interaction({ userId, eventId, type: 'invalid' }).validateSync().errors.type).toBeDefined();
    for (const type of ['favorite', 'attended']) {
      expect(new Interaction({ userId, eventId, type }).validateSync()).toBeUndefined();
    }
  });
});
