import mongoose from 'mongoose';
import MissatgeXatbot from '../src/models/MissatgeXatbot.js';
import SessioXatbot from '../src/models/SessioXatbot.js';

const userId = new mongoose.Types.ObjectId();
const sessionId = new mongoose.Types.ObjectId();

describe('models del xatbot', () => {
  it('desa les sessions a sessionsXatbot i requereix userId', () => {
    expect(SessioXatbot.collection.name).toBe('sessionsXatbot');
    expect(new SessioXatbot({}).validateSync().errors.userId).toBeDefined();
    expect(new SessioXatbot({ userId }).validateSync()).toBeUndefined();
  });

  it('desa missatges a missatgesXatbot i valida sessió, rol i contingut', () => {
    expect(MissatgeXatbot.collection.name).toBe('missatgesXatbot');
    expect(MissatgeXatbot.schema.indexes()).toContainEqual([
      { sessionId: 1, createdAt: 1 },
      { background: true },
    ]);

    const missing = new MissatgeXatbot({}).validateSync();
    expect(missing.errors.sessionId).toBeDefined();
    expect(missing.errors.role).toBeDefined();
    expect(missing.errors.content).toBeDefined();

    const badRole = new MissatgeXatbot({ sessionId, role: 'system', content: 'Hola' }).validateSync();
    expect(badRole.errors.role).toBeDefined();
    expect(new MissatgeXatbot({
      sessionId, role: 'assistant', content: 'a'.repeat(4000),
    }).validateSync()).toBeUndefined();
    expect(new MissatgeXatbot({
      sessionId, role: 'assistant', content: 'a'.repeat(10000),
    }).validateSync()).toBeUndefined();
    const longContent = new MissatgeXatbot({
      sessionId, role: 'assistant', content: 'a'.repeat(10001),
    }).validateSync();
    expect(longContent.errors.content).toBeDefined();
    expect(new MissatgeXatbot({ sessionId, role: 'user', content: 'Hola' }).validateSync()).toBeUndefined();
    expect(new MissatgeXatbot({ sessionId, role: 'assistant', content: 'Bon dia' }).validateSync()).toBeUndefined();
  });
});
