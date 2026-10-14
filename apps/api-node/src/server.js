import app from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`api-node escoltant al port ${PORT}`));
}

start().catch((err) => {
  console.error('Error en arrencar api-node:', err);
  process.exit(1);
});
