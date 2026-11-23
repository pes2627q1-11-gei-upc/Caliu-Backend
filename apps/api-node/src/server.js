import Follow from './models/Follow.js';
import app from './app.js';
import { connectDB } from './config/db.js';
import { getAuthConfig } from './config/auth.js';
import Interaction from './models/Interaction.js';
import Session from './models/Session.js';
import SessioXatbot from './models/SessioXatbot.js';
import MissatgeXatbot from './models/MissatgeXatbot.js';
import { initializeUserIndexes } from './config/userIndexes.js';

const PORT = process.env.PORT || 3000;

async function start() {
  getAuthConfig();
  await connectDB();
  await initializeUserIndexes();
  await Interaction.createIndexes();
  await Follow.createIndexes();
  await Session.init();
  await SessioXatbot.init();
  await MissatgeXatbot.init();
  app.listen(PORT, () => console.log(`api-node escoltant al port ${PORT}`));
}

start().catch((err) => {
  // No imprimim errors del driver: poden contenir URI o credencials.
  console.error('Error en arrencar api-node:', err.name);
  process.exit(1);
});
