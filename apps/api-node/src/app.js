import express from 'express';
import eventsRoutes from './routes/events.routes.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';

// Aquí només es configura l'aplicació. NO s'obre cap port (vegeu server.js),
// així es pot testejar amb supertest.
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-node' });
});

app.use('/events', eventsRoutes);

// Sempre al final
app.use(notFound);
app.use(errorHandler);

export default app;
