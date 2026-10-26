import app from './app.js';
import { connectDB } from './config/db.js';
import { getAuthConfig } from './config/auth.js';
import Session from './models/Session.js';
import { initializeUserIndexes } from './config/userIndexes.js';

const PORT = process.env.PORT || 3000;

async function start() {
  getAuthConfig();
  await connectDB();
  await initializeUserIndexes();
  await Session.init();
  app.listen(PORT, () => console.log(`api-node escoltant al port ${PORT}`));
}

start().catch((err) => {
  // No imprimim errors del driver: poden contenir URI o credencials.
  console.error('Error en arrencar api-node:', err.name);
  process.exit(1);
});
