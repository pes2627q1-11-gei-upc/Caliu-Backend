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

  it('ordena l\'historial per activitat i limita el títol (#163)', () => {
    const session = new SessioXatbot({ userId });
    expect(session.lastActivityAt).toBeInstanceOf(Date);
    expect(session.title).toBeUndefined();
    expect(SessioXatbot.schema.indexes()).toContainEqual([
      { userId: 1, lastActivityAt: -1, _id: -1 },
      { background: true },
    ]);
    expect(new SessioXatbot({ userId, title: 'a'.repeat(80) }).validateSync()).toBeUndefined();
    expect(new SessioXatbot({ userId, title: 'a'.repeat(81) }).validateSync().errors.title).toBeDefined();
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
